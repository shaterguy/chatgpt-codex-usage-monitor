(function attachCodexUsageLayoutCore(globalScope) {
  "use strict";

  const COLLAPSED_SIDEBAR_MAX_WIDTH = 120;
  const NEW_CHAT_SELECTORS = Object.freeze([
    "[data-testid='create-new-chat-button']",
    "[data-testid='new-chat-button']",
    "button[aria-label*='new chat' i]",
    "a[aria-label*='new chat' i]",
    "button[aria-label*='새 채팅']",
    "a[aria-label*='새 채팅']"
  ]);

  function classifySidebarWidth(width) {
    const numericWidth = Number(width);
    if (!Number.isFinite(numericWidth) || numericWidth <= 0) return "unknown";
    return numericWidth <= COLLAPSED_SIDEBAR_MAX_WIDTH ? "collapsed" : "expanded";
  }

  function selectSidebarAnchorCandidate(entries) {
    if (!Array.isArray(entries)) return null;
    const usable = entries.filter((entry) => entry && entry.element && entry.connected === true && entry.visible === true);
    const preferred = usable.find((entry) => entry.insideTinyBar !== true) || usable[0];
    return preferred ? preferred.element : null;
  }

  const api = Object.freeze({
    COLLAPSED_SIDEBAR_MAX_WIDTH,
    NEW_CHAT_SELECTORS,
    classifySidebarWidth,
    selectSidebarAnchorCandidate
  });

  globalScope.CodexUsageLayoutCore = api;
  if (typeof module !== "undefined" && module.exports) module.exports = api;
})(typeof globalThis !== "undefined" ? globalThis : this);
