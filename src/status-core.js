(function attachChatGptStatusCore(globalScope) {
  "use strict";

  const TARGET_COMPONENTS = Object.freeze([
    { name: "Login", aliases: ["Login"], label: "로그인" },
    { name: "Conversations", aliases: ["Conversations"], label: "대화" },
    { name: "ChatGPT Work", aliases: ["ChatGPT Work"], label: "ChatGPT Work" },
    { name: "Files", aliases: ["Files", "File uploads"], label: "파일" },
    { name: "Search", aliases: ["Search"], label: "검색" },
    { name: "Connectors/Apps", aliases: ["Connectors/Apps"], label: "연결 앱" },
    { name: "GPTs", aliases: ["GPTs"], label: "GPTs" },
    { name: "Image Generation", aliases: ["Image Generation"], label: "이미지 생성" },
    { name: "Agent", aliases: ["Agent"], label: "에이전트" },
    { name: "Sites", aliases: ["Sites"], label: "Sites" },
    { name: "Codex Web", aliases: ["Codex Web"], label: "Codex Web" }
  ]);

  const STATUS_DETAILS = Object.freeze({
    operational: { label: "정상", tone: "healthy", severity: 0 },
    under_maintenance: { label: "점검 중", tone: "warning", severity: 1 },
    maintenance: { label: "점검 중", tone: "warning", severity: 1 },
    degraded_performance: { label: "성능 저하", tone: "warning", severity: 2 },
    partial_outage: { label: "일부 장애", tone: "danger", severity: 3 },
    major_outage: { label: "대규모 장애", tone: "danger", severity: 4 }
  });

  function detailFor(status) {
    return STATUS_DETAILS[status] || { label: "확인 필요", tone: "neutral", severity: 2 };
  }

  function selectWorst(entries) {
    return entries.reduce((worst, entry) => {
      if (!worst) return entry;
      return detailFor(entry.status).severity > detailFor(worst.status).severity ? entry : worst;
    }, null);
  }

  function normalizeStatus(payload) {
    const source = payload && Array.isArray(payload.components) ? payload.components : [];
    const components = TARGET_COMPONENTS.map((target) => {
      const matches = source.filter((component) => component && target.aliases.includes(component.name));
      const selected = selectWorst(matches);
      if (!selected) return null;
      const details = detailFor(selected.status);
      const updatedTimes = matches
        .map((entry) => Date.parse(entry.updated_at || entry.updatedAt || ""))
        .filter(Number.isFinite);
      return {
        id: target.name.toLowerCase().replace(/[^a-z0-9]+/g, "-"),
        name: target.name,
        label: target.label,
        status: selected.status,
        statusLabel: details.label,
        tone: details.tone,
        severity: details.severity,
        updatedAt: updatedTimes.length ? Math.max(...updatedTimes) : null
      };
    }).filter(Boolean);

    const worst = selectWorst(components);
    const overallDetails = worst ? detailFor(worst.status) : detailFor("unknown");
    const updatedTimes = components.map((entry) => entry.updatedAt).filter(Number.isFinite);

    return {
      available: components.length > 0,
      overall: worst ? worst.status : "unknown",
      overallLabel: worst && worst.status === "operational" ? "모두 정상" : overallDetails.label,
      tone: overallDetails.tone,
      updatedAt: updatedTimes.length ? Math.max(...updatedTimes) : null,
      components
    };
  }

  const api = Object.freeze({ detailFor, normalizeStatus, TARGET_COMPONENTS });
  globalScope.ChatGptStatusCore = api;
  if (typeof module !== "undefined" && module.exports) module.exports = api;
})(typeof globalThis !== "undefined" ? globalThis : this);
