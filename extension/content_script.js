(function () {
  "use strict";

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
    // Method 1: from page title
    const m = document.title.match(/^ChatGPT\s*-\s*(.+)$/);
    if (m) return m[1].trim();
    // Method 2: heading element
    const h = document.querySelector(".text-center.text-2xl.font-semibold");
    if (h) return h.textContent.trim();
    // Method 3: sr-only labels
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

  // ---- SEND TO BACKGROUND ----
  function sendToBg(type, data) {
    return new Promise((resolve) => {
      try {
        chrome.runtime.sendMessage({ type, ...data }, (response) => {
          if (chrome.runtime.lastError) {
            log("BG send error:", chrome.runtime.lastError.message);
            resolve(null);
          } else {
            resolve(response);
          }
        });
      } catch (e) {
        log("BG send exception:", e.message);
        resolve(null);
      }
    });
  }

  // ---- CORE: CHECK AND LOG NEW EXCHANGES ----
  function checkForNewExchanges() {
    // Gate 1: Must be on a custom GPT URL
    if (!isCustomGptUrl()) return;

    // Gate 2: Extract and validate GPT name
    const name = extractGptName();
    if (!name || !ALLOWED_GPTS.has(name)) return;

    // Gate 3: Must have a conversation ID (means a chat is active)
    const cid = getConversationId();
    if (!cid) return;

    // Detect conversation change (new chat)
    if (currentConversationId && currentConversationId !== cid) {
      log("Conversation changed:", currentConversationId, "->", cid);
      lastLoggedExchangeCount = 0;
      firstUserQuestion = null;
    }

    currentGptName = name;
    currentConversationId = cid;

    // Count completed exchanges (assistant messages = exchanges)
    const exchangeCount = countAssistantMessages();
    if (exchangeCount === 0) return;
    if (exchangeCount <= lastLoggedExchangeCount) return;

    // We have new exchanges to log
    const msgId = getLatestAssistantMsgId();
    if (!msgId) return;

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
      if (resp) {
        log("BG acknowledged:", JSON.stringify(resp));
      } else {
        log("BG did not respond (worker may be inactive)");
      }
    });

    lastLoggedExchangeCount = exchangeCount;
  }

  // ---- INIT: handshake with background ----
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

  // Listen for BG_READY broadcast
  chrome.runtime.onMessage.addListener((msg) => {
    if (msg.type === "BG_READY") {
      bgReady = true;
      log("Received BG_READY broadcast");
      checkForNewExchanges();
    }
  });

  // ---- MAIN POLLING LOOP ----
  // Simple, reliable polling every 3 seconds
  // No complex mutation observers - just check the DOM state
  function startPolling() {
    let lastUrl = window.location.href;

    setInterval(() => {
      const curUrl = window.location.href;

      // Detect URL change (SPA navigation)
      if (curUrl !== lastUrl) {
        log("URL changed:", curUrl);
        lastUrl = curUrl;

        // If navigated away from a GPT or to a different chat, reset
        if (!isCustomGptUrl()) {
          currentGptName = null;
          currentConversationId = null;
          lastLoggedExchangeCount = 0;
          firstUserQuestion = null;
          return;
        }
      }

      // Check for new exchanges
      checkForNewExchanges();
    }, 3000);
  }

  // ---- STARTUP ----
  log("Content script loaded:", window.location.href);

  // Handshake with background (retry a few times)
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

  // Start the polling loop
  startPolling();

  // Also check immediately after a short delay (page may still be loading)
  setTimeout(checkForNewExchanges, 2000);
  setTimeout(checkForNewExchanges, 5000);
  setTimeout(checkForNewExchanges, 10000);

  // Watch for title changes (ChatGPT updates title on navigation)
  const titleEl = document.querySelector("title");
  if (titleEl) {
    new MutationObserver(() => {
      setTimeout(checkForNewExchanges, 1000);
    }).observe(titleEl, { childList: true });
  }
})();
