(function () {
  "use strict";

  // ---- DUPLICATE INSTANCE GUARD ----
  // If a previous instance exists, check if its chrome.runtime context is still alive.
  // After extension reload/update, the old script is orphaned (dead context) and
  // a fresh injection must be allowed to take over.
  if (window.__gptTrackerLoaded) {
    try {
      chrome.runtime.getURL(""); // throws if context is dead
      console.log("[GPT-Tracker] Already loaded with live context, skipping.");
      return;
    } catch (e) {
      console.log("[GPT-Tracker] Previous instance dead, reinitializing...");
    }
  }
  window.__gptTrackerLoaded = true;

  const ALLOWED_GPTS = new Set([
    "ARM Assist",
    "CDS SOP Assist",
    "CashLane Collections SOP Assist",
    "CashLane Loans SOP Assist",
    "Asset Recovery Debt Collection Training",
    "Key 2 Recovery Debt Collection Training",
    "Guglielmo & Associates Debt Collection Training",
    "EVEREST RECEIVABLES Debt Collection Training",
    "Credit Card Debt Collection Training",
    "Auto Loan Debt Collection Trainer",
    "Medical Debt Collector Trainer",
  ]);

  // ---- STATE ----
  let currentGptName = null;
  let currentConversationId = null;
  let lastLoggedExchangeCount = 0;
  let firstUserQuestion = null;
  let bgReady = false;
  let pendingQueue = []; // Queue for messages that failed due to worker sleep

  // ---- LOGGING ----
  function log(...a) {
    console.log("[GPT-Tracker]", ...a);
  }

  // ---- URL CHECKS ----
  function isCustomGptUrl() {
    return /\/g\/g-[a-zA-Z0-9]+-/.test(window.location.pathname);
  }

  function getConversationId() {
    const m = window.location.pathname.match(/\/c\/([a-f0-9-]+)/);
    return m ? m[1] : null;
  }

  // ---- GPT NAME EXTRACTION ----
  function extractGptName() {
    const m = document.title.match(/^ChatGPT\s*-\s*(.+)$/);
    if (m) return m[1].trim();
    const h = document.querySelector(".text-center.text-2xl.font-semibold");
    if (h) return h.textContent.trim();
    for (const el of document.querySelectorAll(".sr-only")) {
      const s = el.textContent.match(/^(.+?)\s+said:$/);
      if (s && s[1] !== "You") return s[1].trim();
    }
    return null;
  }

  // ---- DOM QUERIES ----
  function countAssistantMessages() {
    return document.querySelectorAll('[data-message-author-role="assistant"]').length;
  }

  function getLatestAssistantMsgId() {
    const msgs = document.querySelectorAll('[data-message-author-role="assistant"]');
    if (msgs.length === 0) return null;
    return msgs[msgs.length - 1].getAttribute("data-message-id");
  }

  function getFirstUserQuestion() {
    const el = document.querySelector('[data-message-author-role="user"]');
    if (!el) return null;
    const txt = el.textContent.trim();
    const words = txt.split(/\s+/);
    return words.length <= 20 ? words.join(" ") : words.slice(0, 20).join(" ") + "...";
  }

  // ---- SEND TO BACKGROUND (with retry on worker sleep) ----
  function sendToBg(type, data, retries) {
    retries = retries || 0;
    return new Promise((resolve) => {
      try {
        chrome.runtime.sendMessage({ type, ...data }, (response) => {
          if (chrome.runtime.lastError) {
            const err = chrome.runtime.lastError.message;
            log("BG send error:", err);
            // If context invalidated or disconnected, retry up to 3 times
            if (retries < 3 && (err.includes("invalidated") || err.includes("disconnected") || err.includes("Receiving end does not exist"))) {
              log("Retrying in 1s (attempt " + (retries + 1) + ")...");
              setTimeout(() => {
                sendToBg(type, data, retries + 1).then(resolve);
              }, 1000); 
            } else {
              resolve(null);
            }
          } else {
            resolve(response);
          }
        });
      } catch (e) {
        log("BG send exception:", e.message);
        if (retries < 3) {
          log("Retrying in 1.5s after exception (attempt " + (retries + 1) + ")...");
          setTimeout(() => {
            sendToBg(type, data, retries + 1).then(resolve);
          }, 1500);
        } else {
          log("All retries exhausted, queuing for later...");
          pendingQueue.push({ type, data });
          resolve(null);
        }
      }
    });
  }

  // ---- KEEPALIVE: Ping background every 20s to prevent sleep ----
  setInterval(() => {
    try {
      chrome.runtime.sendMessage({ type: "PING" }, (response) => {
        if (chrome.runtime.lastError) {
          log("PING failed (worker may be asleep):", chrome.runtime.lastError.message);
          return;
        }
        // Worker is alive - flush any pending messages
        if (pendingQueue.length > 0) {
          log("Worker alive, flushing " + pendingQueue.length + " pending messages");
          const queue = pendingQueue.splice(0);
          queue.forEach((item) => sendToBg(item.type, item.data));
        }
      });
    } catch (e) {
      // Extension context fully invalidated - page needs reload
    }
  }, 20000);

  // ---- CORE: CHECK AND LOG NEW EXCHANGES ----
  function checkForNewExchanges() {
    if (!isCustomGptUrl()) return;

    const name = extractGptName();
    if (!name || !ALLOWED_GPTS.has(name)) return;

    const cid = getConversationId();
    if (!cid) return;

    // Detect conversation change
    if (currentConversationId && currentConversationId !== cid) {
      log("Conversation changed:", currentConversationId, "->", cid);
      lastLoggedExchangeCount = 0;
      firstUserQuestion = null;
    }

    currentGptName = name;
    currentConversationId = cid;

    const exchangeCount = countAssistantMessages();
    if (exchangeCount === 0) return;
    if (exchangeCount <= lastLoggedExchangeCount) return;

    const msgId = getLatestAssistantMsgId();
    if (!msgId) return;

    // Skip placeholder IDs - response is still streaming, wait for real ID
    if (msgId.startsWith("request-placeholder-")) {
      log("Skipping placeholder message (still streaming):", msgId);
      return;
    }

    if (!firstUserQuestion) {
      firstUserQuestion = getFirstUserQuestion();
    }

    const payload = {
      gpt_name: name,
      conversation_id: cid,
      turn_number: exchangeCount,
      first_question_summary: firstUserQuestion || "",
      message_id: msgId,
      timestamp: new Date().toISOString(),
    };

    log("Logging exchange #" + exchangeCount + ":", JSON.stringify(payload));

    sendToBg("LOG_EXCHANGE", payload).then((resp) => {
      if (resp && resp.success) {
        log("BG acknowledged, confirmed turn #" + exchangeCount);
        lastLoggedExchangeCount = exchangeCount;
      } else {
        log("BG did not confirm - will retry on next poll cycle");
        // Do NOT bump lastLoggedExchangeCount so next poll retries this turn
      }
    });
  }

  // ---- INIT ----
  async function initBackground() {
    log("Sending INIT to background...");
    const resp = await sendToBg("INIT", { url: window.location.href });
    if (resp) {
      bgReady = true;
      log("Background ready:", JSON.stringify(resp));
    } else {
      log("Background not responding, will retry...");
    }
  }

  chrome.runtime.onMessage.addListener((msg) => {
    if (msg.type === "BG_READY") {
      bgReady = true;
      log("Received BG_READY broadcast");
      checkForNewExchanges();
    }
  });

  // ---- MAIN POLLING LOOP (every 3s) ----
  function startPolling() {
    let lastUrl = window.location.href;

    setInterval(() => {
      const curUrl = window.location.href;

      if (curUrl !== lastUrl) {
        log("URL changed:", curUrl);
        lastUrl = curUrl;

        if (!isCustomGptUrl()) {
          currentGptName = null;
          currentConversationId = null;
          lastLoggedExchangeCount = 0;
          firstUserQuestion = null;
          return;
        }
      }

      checkForNewExchanges();
    }, 3000);
  }

  // ---- STARTUP ----
  log("Content script loaded:", window.location.href);

  initBackground();
  let retryCount = 0;
  const retryInterval = setInterval(() => {
    if (bgReady || retryCount >= 5) {
      clearInterval(retryInterval);
      return;
    }
    retryCount++;
    log("Retrying INIT #" + retryCount);
    initBackground();
  }, 2000);

  startPolling();

  setTimeout(checkForNewExchanges, 2000);
  setTimeout(checkForNewExchanges, 5000);
  setTimeout(checkForNewExchanges, 10000);

  const titleEl = document.querySelector("title");
  if (titleEl) {
    new MutationObserver(() => {
      setTimeout(checkForNewExchanges, 1000);
    }).observe(titleEl, { childList: true });
  }
})();
