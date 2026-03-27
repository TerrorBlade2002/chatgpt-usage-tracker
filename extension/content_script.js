(function () {
  "use strict";

  const ALLOWED_GPTS = new Set([
    "ARM Assist", "CDS SOP Assist", "CashLane Collections SOP Assist",
    "CashLane Loans SOP Assist", "Asset Recovery Debt Collection Training",
    "Key 2 Recovery Debt Collection Training",
    "Guglielmo & Associates Debt Collection Training",
    "EVEREST RECEIVABLES Debt Collection Training",
    "Credit Card Debt Collection Training", "Auto Loan Debt Collection Trainer",
    "Medical Debt Collector Trainer",
  ]);

  let isTracking = false;
  let currentGptName = null;
  let currentConversationId = null;
  let lastLoggedTurnCount = 0;
  let firstUserQuestion = null;
  let observer = null;
  let observedTarget = null;
  let handshakeRetries = 0;
  const MAX_RETRIES = 10;
  const URL_POLL_MS = 800;

  function log(...a) { console.log("[GPT-Tracker]", ...a); }

  function isCustomGptUrl() {
    return /\/g\/g-[a-zA-Z0-9]+-/.test(window.location.pathname);
  }

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

  function isAllowedGpt(n) { return n && ALLOWED_GPTS.has(n); }

  function getConversationId() {
    const m = window.location.pathname.match(/\/c\/([a-f0-9-]+)/);
    return m ? m[1] : null;
  }

  function countTurns() {
    return document.querySelectorAll('[data-testid^="conversation-turn-"]').length;
  }

  function getFirstUserQuestion() {
    const el = document.querySelector('[data-testid="conversation-turn-1"] [data-message-author-role="user"]');
    if (!el) return null;
    const w = el.textContent.trim().split(/\s+/);
    return w.length <= 20 ? w.join(" ") : w.slice(0, 20).join(" ") + "...";
  }

  function getLatestAssistantMsgId() {
    const msgs = document.querySelectorAll('[data-message-author-role="assistant"]');
    return msgs.length ? msgs[msgs.length - 1].getAttribute("data-message-id") : null;
  }

  function sendToBg(type, data) {
    try {
      chrome.runtime.sendMessage({ type, ...data }, () => {
        if (chrome.runtime.lastError) log("BG err:", chrome.runtime.lastError.message);
      });
    } catch (e) { log("Send fail:", e.message); }
  }

  function logExchange() {
    const turns = countTurns();
    const ex = Math.floor(turns / 2);
    if (ex <= lastLoggedTurnCount || ex === 0) return;
    const cid = getConversationId();
    if (!cid) return;
    if (!firstUserQuestion) firstUserQuestion = getFirstUserQuestion();
    const mid = getLatestAssistantMsgId();
    if (!mid) return;

    // Check if conversation changed (new chat)
    if (currentConversationId && currentConversationId !== cid) {
      log("New chat detected, resetting counts");
      lastLoggedTurnCount = 0;
      firstUserQuestion = getFirstUserQuestion();
    }
    currentConversationId = cid;

    const payload = {
      gpt_name: currentGptName, conversation_id: cid, turn_number: ex,
      first_question_summary: firstUserQuestion || "", message_id: mid,
      timestamp: new Date().toISOString(),
    };
    log("Logging exchange:", JSON.stringify(payload));
    sendToBg("LOG_EXCHANGE", payload);
    lastLoggedTurnCount = ex;
  }

  function tryLogExchange() {
    const t = countTurns();
    if (t % 2 === 0 && t > 0) logExchange();
  }

  // ---- OBSERVER: attaches to document.body to survive SPA re-renders ----
  function startObserver() {
    if (observer) observer.disconnect();

    // CRITICAL FIX: observe document.body, not main, because main gets replaced
    const target = document.body;
    observedTarget = target;

    observer = new MutationObserver(() => {
      if (!isTracking) return;
      // Debounced check for completed exchanges
      clearTimeout(observer._debounce);
      observer._debounce = setTimeout(tryLogExchange, 2500);
    });

    observer.observe(target, { childList: true, subtree: true });
    log("Observer started on body");
  }

  function stopTracking() {
    if (observer) { observer.disconnect(); observer = null; }
    isTracking = false; currentGptName = null; currentConversationId = null;
    lastLoggedTurnCount = 0; firstUserQuestion = null; observedTarget = null;
    log("Tracking stopped");
  }

  function attemptTracking() {
    if (!isCustomGptUrl()) { if (isTracking) stopTracking(); return; }
    const name = extractGptName();
    if (!isAllowedGpt(name)) { if (isTracking) stopTracking(); return; }

    // If GPT changed, full reset
    if (currentGptName !== name) {
      stopTracking();
      currentGptName = name;
    }

    if (!isTracking) {
      isTracking = true;
      currentConversationId = getConversationId();
      lastLoggedTurnCount = Math.floor(countTurns() / 2);
      firstUserQuestion = getFirstUserQuestion();
      log("ACTIVE: " + name + " baseline=" + lastLoggedTurnCount);
      startObserver();
    }

    // CRITICAL FIX: even if already tracking, ensure observer is still connected
    // ChatGPT SPA may replace DOM nodes. Re-attach if needed.
    if (isTracking && !observer) {
      log("Re-attaching observer (was disconnected)");
      startObserver();
    }
  }

  // ---- URL + DOM polling: catches SPA navigation AND detects completed exchanges ----
  function startPolling() {
    let lastUrl = window.location.href;
    let lastTurnCount = 0;

    setInterval(() => {
      const curUrl = window.location.href;

      // URL changed - SPA navigation
      if (curUrl !== lastUrl) {
        lastUrl = curUrl;
        log("URL changed:", curUrl);
        setTimeout(attemptTracking, 500);
      }

      // Also poll for new turns directly (backup for missed MutationObserver events)
      if (isTracking) {
        const curTurns = countTurns();
        if (curTurns !== lastTurnCount) {
          lastTurnCount = curTurns;
          if (curTurns % 2 === 0 && curTurns > 0) {
            setTimeout(tryLogExchange, 1000);
          }
        }
      }
    }, URL_POLL_MS);
  }

  function initHandshake() {
    sendToBg("INIT", { url: window.location.href });
    chrome.runtime.onMessage.addListener((msg) => {
      if (msg.type === "BG_READY" || msg.type === "BG_BROADCAST_ALIVE") attemptTracking();
    });
    (function retry() {
      if (handshakeRetries >= MAX_RETRIES) { attemptTracking(); return; }
      handshakeRetries++;
      setTimeout(() => { sendToBg("INIT", { url: window.location.href }); retry(); }, 500);
    })();
  }

  log("Content script loaded:", window.location.href);
  initHandshake();
  startPolling();
  const tEl = document.querySelector("title");
  if (tEl) new MutationObserver(() => setTimeout(attemptTracking, 300)).observe(tEl, { childList: true });
})();
