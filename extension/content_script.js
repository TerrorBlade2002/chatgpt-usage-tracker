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

  let isTracking = false;
  let currentGptName = null;
  let currentConversationId = null;
  let baselineTurnCount = 0;
  let lastLoggedTurnCount = 0;
  let firstUserQuestion = null;
  let observer = null;
  let handshakeRetries = 0;
  const MAX_HANDSHAKE_RETRIES = 10;
  const HANDSHAKE_RETRY_MS = 500;
  const URL_POLL_MS = 1000;

  function log(...args) { console.log("[GPT-Tracker]", ...args); }

  function isCustomGptUrl(url) {
    return /\/g\/g-[a-zA-Z0-9]+-/.test(new URL(url).pathname);
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

  function isAllowedGpt(name) { return name && ALLOWED_GPTS.has(name); }

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
    const words = el.textContent.trim().split(/\s+/);
    return words.length <= 20 ? words.join(" ") : words.slice(0, 20).join(" ") + "...";
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
    if (ex <= lastLoggedTurnCount) return;
    const cid = getConversationId();
    if (!cid) return;
    if (!firstUserQuestion) firstUserQuestion = getFirstUserQuestion();
    const mid = getLatestAssistantMsgId();
    if (!mid) return;
    sendToBg("LOG_EXCHANGE", {
      gpt_name: currentGptName, conversation_id: cid, turn_number: ex,
      first_question_summary: firstUserQuestion || "", message_id: mid,
      timestamp: new Date().toISOString(),
    });
    lastLoggedTurnCount = ex;
    if (currentConversationId && currentConversationId !== cid) firstUserQuestion = getFirstUserQuestion();
    currentConversationId = cid;
  }

  function startObserver() {
    if (observer) observer.disconnect();
    const tgt = document.querySelector("main") || document.body;
    observer = new MutationObserver((muts) => {
      let chk = false;
      for (const m of muts) {
        for (const n of m.addedNodes) {
          if (n.nodeType === 1) {
            if ((n.getAttribute?.("data-testid") || "").startsWith("conversation-turn-")) { chk = true; break; }
            if (n.querySelector?.('[data-testid^="conversation-turn-"]')) { chk = true; break; }
          }
        }
        if (chk) break;
      }
      if (chk) setTimeout(() => { const t = countTurns(); if (t % 2 === 0 && t > 0) logExchange(); }, 2000);
    });
    observer.observe(tgt, { childList: true, subtree: true });
    log("Observer started");
  }

  function stopTracking() {
    if (observer) { observer.disconnect(); observer = null; }
    isTracking = false; currentGptName = null; currentConversationId = null;
    baselineTurnCount = 0; lastLoggedTurnCount = 0; firstUserQuestion = null;
  }

  function attemptTracking() {
    if (!isCustomGptUrl(window.location.href)) { if (isTracking) stopTracking(); return; }
    const name = extractGptName();
    if (!isAllowedGpt(name)) { if (isTracking) stopTracking(); return; }
    if (currentGptName !== name) { stopTracking(); currentGptName = name; }
    if (!isTracking) {
      isTracking = true;
      currentConversationId = getConversationId();
      baselineTurnCount = Math.floor(countTurns() / 2);
      lastLoggedTurnCount = baselineTurnCount;
      firstUserQuestion = getFirstUserQuestion();
      log("ACTIVE: " + name + " baseline=" + baselineTurnCount);
      startObserver();
    }
  }

  function startUrlPolling() {
    let last = window.location.href;
    setInterval(() => { const c = window.location.href; if (c !== last) { last = c; setTimeout(attemptTracking, 500); } }, URL_POLL_MS);
  }

  function initHandshake() {
    sendToBg("INIT", { url: window.location.href });
    chrome.runtime.onMessage.addListener((msg) => {
      if (msg.type === "BG_READY" || msg.type === "BG_BROADCAST_ALIVE") attemptTracking();
    });
    (function retry() {
      if (handshakeRetries >= MAX_HANDSHAKE_RETRIES) { attemptTracking(); return; }
      handshakeRetries++;
      setTimeout(() => { sendToBg("INIT", { url: window.location.href }); retry(); }, HANDSHAKE_RETRY_MS);
    })();
  }

  log("Content script loaded:", window.location.href);
  initHandshake();
  startUrlPolling();
  const tEl = document.querySelector("title");
  if (tEl) new MutationObserver(() => setTimeout(attemptTracking, 300)).observe(tEl, { childList: true });
})();
