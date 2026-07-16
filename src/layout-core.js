(function attachCodexUsageLayoutCore(globalScope) {
  "use strict";

  const COLLAPSED_SIDEBAR_MAX_WIDTH = 120;

  function classifySidebarWidth(width) {
    const numericWidth = Number(width);
    if (!Number.isFinite(numericWidth) || numericWidth <= 0) return "unknown";
    return numericWidth <= COLLAPSED_SIDEBAR_MAX_WIDTH ? "collapsed" : "expanded";
  }

  const api = Object.freeze({
    COLLAPSED_SIDEBAR_MAX_WIDTH,
    classifySidebarWidth
  });

  globalScope.CodexUsageLayoutCore = api;
  if (typeof module !== "undefined" && module.exports) module.exports = api;
})(typeof globalThis !== "undefined" ? globalThis : this);
