// ============================================================
// ChatGPT Usage Tracker - Background Service Worker
// ============================================================

const NATIVE_HOST = "com.astraglobal.gpt_tracker";
const DEFAULT_SERVER_URL = "https://chatgpt-usage-tracker-production.up.railway.app";

let systemUsername = null;
let sessionId = null;
let serverUrl = DEFAULT_SERVER_URL;
let retryQueue = [];
let isProcessingQueue = false;

console.log("[BG] Background service worker starting...");

function generateUUID() {
  return "xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx".replace(/[xy]/g, (c) => {
    const r = (Math.random() * 16) | 0;
    return (c === "x" ? r : (r & 0x3) | 0x8).toString(16);
  });
}

async function hashKey(str) {
  const data = new TextEncoder().encode(str);
  const buf = await crypto.subtle.digest("SHA-256", data);
  return Array.from(new Uint8Array(buf)).map(b => b.toString(16).padStart(2, "0")).join("");
}

async function loadConfig() {
  return new Promise((resolve) => {
    chrome.storage.local.get(["serverUrl"], (result) => {
      if (result.serverUrl) serverUrl = result.serverUrl;
      console.log("[BG] Server URL:", serverUrl);
      resolve();
    });
  });
}

function fetchSystemUsername() {
  return new Promise((resolve) => {
    try {
      console.log("[BG] Attempting native messaging...");
      chrome.runtime.sendNativeMessage(NATIVE_HOST, { action: "get_username" }, (response) => {
        if (chrome.runtime.lastError) {
          console.warn("[BG] Native msg error:", chrome.runtime.lastError.message);
          chrome.storage.local.get(["manualUsername"], (r) => {
            resolve(r.manualUsername || "UNKNOWN_USER");
          });
          return;
        }
        if (response && response.username) {
          console.log("[BG] Got username:", response.username);
          resolve(response.username);
        } else {
          resolve("UNKNOWN_USER");
        }
      });
    } catch (e) {
      console.warn("[BG] Native msg unavailable:", e.message);
      chrome.storage.local.get(["manualUsername"], (r) => {
        resolve(r.manualUsername || "UNKNOWN_USER");
      });
    }
  });
}

async function initSession() {
  console.log("[BG] Initializing session...");
  await loadConfig();
  const cached = await new Promise((r) =>
    chrome.storage.session.get(["systemUsername", "sessionId"], (d) => r(d))
  );
  if (cached.systemUsername && cached.sessionId) {
    systemUsername = cached.systemUsername;
    sessionId = cached.sessionId;
    console.log("[BG] Restored session:", systemUsername, sessionId);
    return;
  }
  systemUsername = await fetchSystemUsername();
  sessionId = generateUUID();
  chrome.storage.session.set({ systemUsername, sessionId });
  console.log("[BG] New session:", systemUsername, sessionId);
}

// ---- RE-INJECT CONTENT SCRIPT INTO EXISTING TABS ----
// This is critical: when the extension is reloaded/updated, all existing
// ChatGPT tabs have a dead content script. We must re-inject fresh ones.
async function reinjectContentScripts() {
  console.log("[BG] Re-injecting content scripts into existing ChatGPT tabs...");
  try {
    const tabs = await chrome.tabs.query({ url: "https://chatgpt.com/*" });
    for (const tab of tabs) {
      try {
        await chrome.scripting.executeScript({
          target: { tabId: tab.id },
          files: ["content_script.js"],
        });
        console.log("[BG] Re-injected into tab:", tab.id, tab.url);
      } catch (e) {
        console.warn("[BG] Failed to inject into tab", tab.id, ":", e.message);
      }
    }
  } catch (e) {
    console.warn("[BG] Re-injection failed:", e.message);
  }
}

async function sendToServer(payload) {
  if (!sessionId) {
    console.log("[BG] Session not ready, initializing...");
    await initSession();
  }
  const idempotencyKey = await hashKey(payload.message_id);
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
  console.log("[BG] Sending to server:", JSON.stringify(body));
  try {
    const resp = await fetch(serverUrl + "/api/log", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });
    if (!resp.ok) {
      const text = await resp.text();
      console.error("[BG] Server error:", resp.status, text);
      if (resp.status >= 500) retryQueue.push(body);
      return false;
    }
    const data = await resp.json();
    console.log("[BG] Logged OK:", JSON.stringify(data));
    return true;
  } catch (e) {
    console.error("[BG] Network error:", e.message);
    retryQueue.push(body);
    return false;
  }
}

async function processRetryQueue() {
  if (isProcessingQueue || retryQueue.length === 0) return;
  isProcessingQueue = true;
  const batch = retryQueue.splice(0, 10);
  for (const item of batch) {
    try {
      const resp = await fetch(serverUrl + "/api/log", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(item),
      });
      if (!resp.ok && resp.status >= 500) retryQueue.push(item);
    } catch (e) {
      retryQueue.push(item);
    }
  }
  isProcessingQueue = false;
}

setInterval(processRetryQueue, 30000);

// ---- MESSAGE LISTENER ----
chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
  console.log("[BG] Received message:", msg.type, "from tab:", sender.tab?.id);

  if (msg.type === "PING") {
    sendResponse({ status: "alive" });
    return true;
  }

  if (msg.type === "INIT") {
    const doInit = async () => {
      try {
        if (!systemUsername) {
          await initSession();
          console.log("[BG] Session ready after INIT, broadcasting BG_READY");
          chrome.tabs.query({ url: "https://chatgpt.com/*" }, (tabs) => {
            tabs.forEach((tab) => {
              chrome.tabs.sendMessage(tab.id, { type: "BG_READY" }).catch(() => {});
            });
          });
        } else {
          console.log("[BG] Already initialized, sending BG_READY to tab:", sender.tab?.id);
          if (sender.tab?.id) {
            chrome.tabs.sendMessage(sender.tab.id, { type: "BG_READY" }).catch(() => {});
          }
        }
        sendResponse({ status: "ok", username: systemUsername, sessionId });
      } catch (e) {
        console.error("[BG] INIT failed:", e.message);
        sendResponse({ status: "error", error: e.message });
      }
    };
    doInit();
    return true;
  }

  if (msg.type === "LOG_EXCHANGE") {
    console.log("[BG] LOG_EXCHANGE:", msg.gpt_name, "turn:", msg.turn_number);
    sendToServer(msg).then((success) => {
      sendResponse({ success });
    });
    return true;
  }

  if (msg.type === "GET_STATUS") {
    sendResponse({ systemUsername, sessionId, serverUrl, queueLength: retryQueue.length });
    return true;
  }
});

// ---- ON INSTALL / UPDATE ----
chrome.runtime.onInstalled.addListener(async () => {
  console.log("[BG] Extension installed/updated");
  try {
    await initSession();
    await reinjectContentScripts();
  } catch (e) {
    console.error("[BG] onInstalled error:", e.message);
  }
});

chrome.runtime.onStartup.addListener(() => {
  console.log("[BG] Browser startup");
  initSession().catch((e) => console.error("[BG] initSession failed on startup:", e.message));
});

// Initialize on load
console.log("[BG] Calling initSession on load...");
initSession().catch((e) => console.error("[BG] initSession failed on load:", e.message));
