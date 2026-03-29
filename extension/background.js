// ============================================================
// ChatGPT Usage Tracker - Background Service Worker
// Handles: native messaging for username, API calls to server,
//          session management, retry queue, deduplication
// ============================================================

const NATIVE_HOST = "com.astraglobal.gpt_tracker";
const DEFAULT_SERVER_URL = "https://chatgpt-usage-tracker-production.up.railway.app";

let systemUsername = null;
let sessionId = null;
let serverUrl = DEFAULT_SERVER_URL;
let retryQueue = [];
let isProcessingQueue = false;

console.log("[BG] Background service worker starting...");

// ---- UUID GENERATOR ----
function generateUUID() {
  return "xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx".replace(/[xy]/g, (c) => {
    const r = (Math.random() * 16) | 0;
    return (c === "x" ? r : (r & 0x3) | 0x8).toString(16);
  });
}

// ---- SHA-256 HASH FOR IDEMPOTENCY KEY ----
async function hashKey(str) {
  const data = new TextEncoder().encode(str);
  const buf = await crypto.subtle.digest("SHA-256", data);
  return Array.from(new Uint8Array(buf))
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
}

// ---- LOAD CONFIG FROM STORAGE ----
async function loadConfig() {
  return new Promise((resolve) => {
    chrome.storage.local.get(["serverUrl"], (result) => {
      if (result.serverUrl) {
        serverUrl = result.serverUrl;
        console.log("[BG] Using custom server URL:", serverUrl);
      } else {
        console.log("[BG] Using default server URL:", serverUrl);
      }
      resolve();
    });
  });
}

// ---- GET SYSTEM USERNAME VIA NATIVE MESSAGING ----
function fetchSystemUsername() {
  return new Promise((resolve) => {
    try {
      console.log("[BG] Attempting native messaging to get username...");
      chrome.runtime.sendNativeMessage(
        NATIVE_HOST,
        { action: "get_username" },
        (response) => {
          if (chrome.runtime.lastError) {
            console.warn(
              "[BG] Native messaging error:",
              chrome.runtime.lastError.message
            );
            chrome.storage.local.get(["manualUsername"], (r) => {
              const fallback = r.manualUsername || "UNKNOWN_USER";
              console.log("[BG] Using fallback username:", fallback);
              resolve(fallback);
            });
            return;
          }
          if (response && response.username) {
            console.log("[BG] Got username from native host:", response.username);
            resolve(response.username);
          } else {
            console.warn("[BG] Native host returned no username");
            resolve("UNKNOWN_USER");
          }
        }
      );
    } catch (e) {
      console.warn("[BG] Native messaging unavailable:", e.message);
      chrome.storage.local.get(["manualUsername"], (r) => {
        resolve(r.manualUsername || "UNKNOWN_USER");
      });
    }
  });
}

// ---- INITIALIZE SESSION ----
async function initSession() {
  console.log("[BG] Initializing session...");
  await loadConfig();

  // Check if we already have a cached username for this session
  const cached = await new Promise((r) =>
    chrome.storage.session.get(["systemUsername", "sessionId"], (d) => r(d))
  );

  if (cached.systemUsername && cached.sessionId) {
    systemUsername = cached.systemUsername;
    sessionId = cached.sessionId;
    console.log("[BG] Restored session:", systemUsername, sessionId);
    return;
  }

  // Fetch fresh username
  systemUsername = await fetchSystemUsername();
  sessionId = generateUUID();

  // Cache in session storage (cleared when browser closes)
  chrome.storage.session.set({ systemUsername, sessionId });
  console.log("[BG] New session created:", systemUsername, sessionId);
}

// ---- SEND LOG TO SERVER ----
async function sendToServer(payload) {
  // Ensure session is initialized
  if (!sessionId) {
    console.log("[BG] Session not ready, initializing...");
    await initSession();
  }

  const idempotencyKey = await hashKey(sessionId + "|" + payload.message_id);

  const body = {
    session_id: sessionId,
    system_username: systemUsername,
    gpt_name: payload.gpt_name,
    conversation_id: payload.conversation_id,
    turn_number: payload.turn_number,
    first_question_summary: payload.first_question_summary,
    message_id: payload.message_id,
    idempotency_key: idempotencyKey,
    timestamp: payload.timestamp,
  };

  const url = serverUrl + "/api/log";
  console.log("[BG] Sending to server:", url, JSON.stringify(body));

  try {
    const resp = await fetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });

    if (!resp.ok) {
      const text = await resp.text();
      console.error("[BG] Server error:", resp.status, text);
      if (resp.status >= 500) {
        retryQueue.push(body);
        console.log("[BG] Added to retry queue. Queue size:", retryQueue.length);
      }
      return false;
    }

    const data = await resp.json();
    console.log("[BG] Successfully logged! Response:", JSON.stringify(data));
    return true;
  } catch (e) {
    console.error("[BG] Network error:", e.message);
    retryQueue.push(body);
    console.log("[BG] Added to retry queue. Queue size:", retryQueue.length);
    return false;
  }
}

// ---- RETRY QUEUE PROCESSOR ----
async function processRetryQueue() {
  if (isProcessingQueue || retryQueue.length === 0) return;
  isProcessingQueue = true;
  console.log("[BG] Processing retry queue:", retryQueue.length, "items");

  const batch = retryQueue.splice(0, 10);
  for (const item of batch) {
    try {
      const resp = await fetch(serverUrl + "/api/log", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(item),
      });
      if (!resp.ok && resp.status >= 500) {
        retryQueue.push(item);
      } else {
        console.log("[BG] Retry succeeded for:", item.gpt_name);
      }
    } catch (e) {
      retryQueue.push(item);
    }
  }
  isProcessingQueue = false;
}

// Retry queue runs every 30 seconds
setInterval(processRetryQueue, 30000);

// ---- MESSAGE LISTENER ----
chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
  console.log("[BG] Received message:", msg.type, "from tab:", sender.tab?.id);

  if (msg.type === "INIT") {
    if (!systemUsername) {
      initSession().then(() => {
        console.log("[BG] Session ready after INIT, broadcasting BG_READY");
        chrome.tabs.query({ url: "https://chatgpt.com/*" }, (tabs) => {
          tabs.forEach((tab) => {
            chrome.tabs.sendMessage(tab.id, { type: "BG_READY" }).catch(() => {});
          });
        });
      });
    } else {
      console.log("[BG] Already initialized, sending BG_READY to tab:", sender.tab?.id);
      if (sender.tab?.id) {
        chrome.tabs.sendMessage(sender.tab.id, { type: "BG_READY" }).catch(() => {});
      }
    }
    sendResponse({ status: "ok" });
    return true;
  }

  if (msg.type === "LOG_EXCHANGE") {
    console.log("[BG] LOG_EXCHANGE received:", msg.gpt_name, "turn:", msg.turn_number);
    sendToServer(msg).then((success) => {
      console.log("[BG] sendToServer result:", success);
      sendResponse({ success });
    });
    return true; // Keep channel open for async response
  }

  if (msg.type === "GET_STATUS") {
    sendResponse({
      systemUsername,
      sessionId,
      serverUrl,
      queueLength: retryQueue.length,
    });
    return true;
  }
});

// ---- ON INSTALL / UPDATE ----
chrome.runtime.onInstalled.addListener(() => {
  console.log("[BG] Extension installed/updated");
  initSession();
});

// ---- ON STARTUP ----
chrome.runtime.onStartup.addListener(() => {
  console.log("[BG] Browser startup");
  initSession();
});

// Initialize on load
console.log("[BG] Calling initSession on load...");
initSession();
