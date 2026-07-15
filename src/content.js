(async function startCodexUsageBar() {
  "use strict";

  if (window.top !== window || document.getElementById("codex-usage-bar-host")) return;

  const core = globalThis.CodexUsageCore;
  if (!core) return;

  const REQUEST_EVENT = "codex-usage-bar:request";
  const RESPONSE_EVENT = "codex-usage-bar:response";
  const STORAGE_KEY = "codexUsageBarSettingsV1";
  const RESET_PROMPT_SNOOZE_MS = 30 * 60 * 1000;
  const DEFAULT_SETTINGS = Object.freeze({
    position: null,
    expanded: false,
    pollIntervalSeconds: 60,
    resetPromptSnoozedWindowKey: null,
    resetPromptSnoozeUntil: null,
    resetPromptSuppressUntilZeroWindowKey: null
  });

  const state = {
    usage: null,
    loading: true,
    error: null,
    lastUpdatedAt: null,
    endpoint: null,
    activeRequestId: null,
    activeResetRequestId: null,
    requestTimeout: null,
    recoveryTimer: null,
    recoveryAttempts: 0,
    resetRequestTimeout: null,
    resetOfferTimer: null,
    pollTimer: null,
    activityTimer: null,
    generationCheckTimer: null,
    generationActive: false,
    settings: { ...DEFAULT_SETTINGS },
    webStatus: null,
    webStatusLoading: true,
    webStatusError: null,
    resetInFlight: false,
    resetOutcome: null,
    layoutMode: "pending",
    mountTimer: null,
    lastMountAttemptAt: 0,
    dragging: false,
    movedDuringDrag: false
  };

  const host = document.createElement("div");
  host.id = "codex-usage-bar-host";
  host.style.position = "fixed";
  host.style.zIndex = "2147483646";
  host.style.left = "0px";
  host.style.top = "0px";
  host.style.width = "max-content";
  host.style.height = "max-content";
  host.style.visibility = "hidden";
  host.dataset.layout = "pending";
  document.documentElement.appendChild(host);

  const shadow = host.attachShadow({ mode: "open" });
  const style = document.createElement("style");
  try {
    style.textContent = await fetch(chrome.runtime.getURL("src/widget.css")).then((response) => response.text());
  } catch (_error) {
    style.textContent = ":host{font-family:system-ui,sans-serif}.cub-card{background:#202123;color:#fff;padding:12px;border-radius:16px}";
  }

  const card = document.createElement("section");
  card.className = "cub-card";
  card.setAttribute("role", "region");
  card.setAttribute("aria-label", "Codex 사용량");
  card.innerHTML = `
    <div class="cub-summary" id="cub-summary" role="button" tabindex="0" aria-expanded="false" aria-label="Codex 사용량 상세 열기. 드래그하여 이동할 수 있습니다.">
      <div class="cub-brand" aria-hidden="true">&gt;_</div>
      <div class="cub-summary-main">
        <div class="cub-summary-labels">
          <span class="cub-title">Codex</span>
          <span class="cub-plan" id="cub-plan">확인 중</span>
          <span class="cub-server-dot" id="cub-server-dot" data-tone="neutral" title="ChatGPT 웹 상태 확인 중" aria-label="ChatGPT 웹 상태 확인 중"></span>
          <span class="cub-server-label" id="cub-server-label">상태 확인 중</span>
        </div>
        <div class="cub-track cub-track-summary"><span id="cub-summary-fill"></span></div>
      </div>
      <div class="cub-summary-value" id="cub-summary-value" aria-live="polite">…</div>
      <button class="cub-icon-button cub-toggle" id="cub-toggle" type="button" title="상세 보기" aria-label="상세 보기">
        <svg viewBox="0 0 20 20" aria-hidden="true"><path d="m5.5 7.5 4.5 4.5 4.5-4.5"/></svg>
      </button>
    </div>
    <div class="cub-popover" id="cub-popover" role="dialog" aria-label="Codex 사용량 및 ChatGPT 웹 상태" popover="manual" hidden>
    <div class="cub-web-status" id="cub-web-status">
      <div class="cub-web-status-head">
        <div>
          <span class="cub-status-indicator" id="cub-web-status-indicator" data-tone="neutral"></span>
          <strong>ChatGPT 웹 상태</strong>
        </div>
        <span id="cub-web-status-overall">확인 중</span>
      </div>
      <div class="cub-web-status-grid" id="cub-web-status-grid"></div>
      <div class="cub-web-status-foot">
        <span id="cub-web-status-updated">상태 확인 중</span>
        <a href="https://status.openai.com/" target="_blank" rel="noreferrer">상태 페이지</a>
      </div>
    </div>
    <div class="cub-details" id="cub-details" hidden>
      <div class="cub-status-banner" id="cub-status-banner" hidden></div>
      <div class="cub-limit" id="cub-primary-row">
        <div class="cub-limit-head">
          <span id="cub-primary-name">5시간 한도</span>
          <strong id="cub-primary-value">…</strong>
        </div>
        <div class="cub-track"><span id="cub-primary-fill"></span></div>
        <div class="cub-limit-meta">
          <span id="cub-primary-used"></span>
          <span id="cub-primary-reset"></span>
        </div>
      </div>
      <div class="cub-limit" id="cub-secondary-row">
        <div class="cub-limit-head">
          <span id="cub-secondary-name">주간 한도</span>
          <strong id="cub-secondary-value">…</strong>
        </div>
        <div class="cub-track"><span id="cub-secondary-fill"></span></div>
        <div class="cub-limit-meta">
          <span id="cub-secondary-used"></span>
          <span id="cub-secondary-reset"></span>
        </div>
      </div>
      <div id="cub-additional"></div>
      <div class="cub-credit-row" id="cub-credit-row" hidden>
        <div class="cub-credit-main">
          <span>추가 크레딧</span>
          <strong id="cub-credit-value"></strong>
        </div>
        <button class="cub-reset-credit-button" id="cub-use-reset" type="button" hidden>초기화권 사용</button>
      </div>
      <div class="cub-settings" id="cub-settings" hidden>
        <label for="cub-interval">자동 확인 주기</label>
        <select id="cub-interval">
          <option value="30">30초</option>
          <option value="60">60초</option>
          <option value="120">2분</option>
          <option value="300">5분</option>
        </select>
        <button id="cub-reset-position" type="button">대체 위젯 위치 초기화</button>
      </div>
      <div class="cub-footer">
        <span id="cub-updated">확인 중</span>
        <div class="cub-footer-actions">
          <a href="https://chatgpt.com/codex/cloud/settings/analytics" target="_blank" rel="noreferrer" title="공식 Codex 사용량 페이지">공식 화면</a>
          <button class="cub-icon-button" id="cub-settings-button" type="button" title="설정" aria-label="설정">
            <svg viewBox="0 0 20 20" aria-hidden="true"><path d="M8.5 2.5h3l.5 2a6 6 0 0 1 1.2.7l2-.6 1.5 2.6-1.5 1.4a6 6 0 0 1 0 1.4l1.5 1.4-1.5 2.6-2-.6a6 6 0 0 1-1.2.7l-.5 2h-3l-.5-2a6 6 0 0 1-1.2-.7l-2 .6-1.5-2.6L4.8 10a6 6 0 0 1 0-1.4L3.3 7.2l1.5-2.6 2 .6A6 6 0 0 1 8 4.5l.5-2Z"/><circle cx="10" cy="9.3" r="2.2"/></svg>
          </button>
          <button class="cub-icon-button" id="cub-refresh" type="button" title="지금 새로고침" aria-label="지금 새로고침">
            <svg viewBox="0 0 20 20" aria-hidden="true"><path d="M15.5 7A6 6 0 1 0 16 11"/><path d="M15.5 3v4h-4"/></svg>
          </button>
        </div>
      </div>
    </div>
    </div>
  `;
  const resetDialog = document.createElement("div");
  resetDialog.className = "cub-modal-backdrop";
  resetDialog.id = "cub-reset-dialog";
  resetDialog.setAttribute("popover", "manual");
  resetDialog.hidden = true;
  resetDialog.innerHTML = `
    <section class="cub-modal" role="dialog" aria-modal="true" aria-labelledby="cub-reset-title" aria-describedby="cub-reset-description">
      <div class="cub-modal-icon" aria-hidden="true">↻</div>
      <h2 id="cub-reset-title">Codex 초기화권 사용</h2>
      <p id="cub-reset-description">5시간 사용량이 거의 소진됐습니다. 초기화권을 사용하시겠습니까?</p>
      <div class="cub-modal-summary">
        <span id="cub-reset-remaining">5시간 잔여 —</span>
        <span id="cub-reset-count">초기화권 —</span>
      </div>
      <div class="cub-modal-result" id="cub-reset-result" hidden aria-live="polite"></div>
      <div class="cub-modal-actions">
        <button class="cub-secondary-button cub-reset-suppress" id="cub-reset-suppress" type="button">0%까지 알리지 않기</button>
        <button class="cub-secondary-button" id="cub-reset-later" type="button">나중에 (30분 후)</button>
        <button class="cub-primary-button" id="cub-reset-confirm" type="button">초기화권 사용</button>
      </div>
    </section>
  `;
  shadow.append(style, card, resetDialog);

  const elements = {
    summary: shadow.getElementById("cub-summary"),
    toggle: shadow.getElementById("cub-toggle"),
    popover: shadow.getElementById("cub-popover"),
    details: shadow.getElementById("cub-details"),
    plan: shadow.getElementById("cub-plan"),
    summaryFill: shadow.getElementById("cub-summary-fill"),
    summaryValue: shadow.getElementById("cub-summary-value"),
    serverDot: shadow.getElementById("cub-server-dot"),
    serverLabel: shadow.getElementById("cub-server-label"),
    statusBanner: shadow.getElementById("cub-status-banner"),
    additional: shadow.getElementById("cub-additional"),
    creditRow: shadow.getElementById("cub-credit-row"),
    creditValue: shadow.getElementById("cub-credit-value"),
    useReset: shadow.getElementById("cub-use-reset"),
    webStatus: shadow.getElementById("cub-web-status"),
    webStatusIndicator: shadow.getElementById("cub-web-status-indicator"),
    webStatusOverall: shadow.getElementById("cub-web-status-overall"),
    webStatusGrid: shadow.getElementById("cub-web-status-grid"),
    webStatusUpdated: shadow.getElementById("cub-web-status-updated"),
    updated: shadow.getElementById("cub-updated"),
    refresh: shadow.getElementById("cub-refresh"),
    settingsButton: shadow.getElementById("cub-settings-button"),
    settings: shadow.getElementById("cub-settings"),
    interval: shadow.getElementById("cub-interval"),
    resetPosition: shadow.getElementById("cub-reset-position"),
    resetDialog,
    resetRemaining: shadow.getElementById("cub-reset-remaining"),
    resetCount: shadow.getElementById("cub-reset-count"),
    resetResult: shadow.getElementById("cub-reset-result"),
    resetSuppress: shadow.getElementById("cub-reset-suppress"),
    resetLater: shadow.getElementById("cub-reset-later"),
    resetConfirm: shadow.getElementById("cub-reset-confirm"),
    primary: limitElements("primary"),
    secondary: limitElements("secondary")
  };

  function limitElements(prefix) {
    return {
      row: shadow.getElementById(`cub-${prefix}-row`),
      name: shadow.getElementById(`cub-${prefix}-name`),
      value: shadow.getElementById(`cub-${prefix}-value`),
      fill: shadow.getElementById(`cub-${prefix}-fill`),
      used: shadow.getElementById(`cub-${prefix}-used`),
      reset: shadow.getElementById(`cub-${prefix}-reset`)
    };
  }

  async function loadSettings() {
    try {
      const stored = await chrome.storage.local.get(STORAGE_KEY);
      state.settings = { ...DEFAULT_SETTINGS, ...(stored[STORAGE_KEY] || {}) };
    } catch (_error) {
      state.settings = { ...DEFAULT_SETTINGS };
    }
    const allowedIntervals = [30, 60, 120, 300];
    if (!allowedIntervals.includes(Number(state.settings.pollIntervalSeconds))) {
      state.settings.pollIntervalSeconds = DEFAULT_SETTINGS.pollIntervalSeconds;
    }
  }

  let saveTimer = null;
  function saveSettings() {
    clearTimeout(saveTimer);
    saveTimer = setTimeout(() => {
      chrome.storage.local.set({ [STORAGE_KEY]: state.settings }).catch(() => {});
    }, 120);
  }

  function defaultPosition() {
    const width = host.getBoundingClientRect().width || 276;
    return { x: Math.max(12, window.innerWidth - width - 24), y: 76 };
  }

  function applyPosition(position) {
    if (state.layoutMode !== "floating") return position || state.settings.position;
    const rect = host.getBoundingClientRect();
    const margin = 8;
    const maximumX = Math.max(margin, window.innerWidth - rect.width - margin);
    const maximumY = Math.max(margin, window.innerHeight - rect.height - margin);
    const target = position || defaultPosition();
    const x = core.clamp(Number(target.x) || 0, margin, maximumX);
    const y = core.clamp(Number(target.y) || 0, margin, maximumY);
    host.style.left = `${Math.round(x)}px`;
    host.style.top = `${Math.round(y)}px`;
    return { x: Math.round(x), y: Math.round(y) };
  }

  function directChildBelow(node, ancestor) {
    let current = node;
    while (current && current.parentElement && current.parentElement !== ancestor) current = current.parentElement;
    return current && current.parentElement === ancestor ? current : null;
  }

  function elementLabel(element) {
    if (!element) return "";
    return [
      element.getAttribute("aria-label"),
      element.getAttribute("title"),
      element.getAttribute("data-testid"),
      element.textContent
    ].filter(Boolean).join(" ").replace(/\s+/g, " ").trim();
  }

  function findSemanticElement(root, selectors, pattern) {
    for (const selector of selectors) {
      let candidates = [];
      try {
        candidates = [...root.querySelectorAll(selector)];
      } catch (_error) {
        candidates = [];
      }
      const match = candidates.find((candidate) => !pattern || pattern.test(elementLabel(candidate)));
      if (match) return match;
    }
    const interactive = [...root.querySelectorAll("button, a, [role='button']")];
    return interactive.find((candidate) => pattern.test(elementLabel(candidate))) || null;
  }

  function commonMountTarget(planElement, newChatElement) {
    let ancestor = newChatElement && newChatElement.parentElement;
    for (let depth = 0; ancestor && depth < 8; depth += 1, ancestor = ancestor.parentElement) {
      if (!planElement || !ancestor.contains(planElement)) continue;
      const before = directChildBelow(newChatElement, ancestor);
      const planChild = directChildBelow(planElement, ancestor);
      if (before && planChild && before !== planChild) return { container: ancestor, before };
    }
    return null;
  }

  function nearbyNewChatTarget(newChatElement, root) {
    let ancestor = newChatElement && newChatElement.parentElement;
    for (let depth = 0; ancestor && depth < 5; depth += 1, ancestor = ancestor.parentElement) {
      if (root !== document && !root.contains(ancestor)) break;
      const interactiveCount = ancestor.querySelectorAll("button, a, [role='button']").length;
      const before = directChildBelow(newChatElement, ancestor);
      if (before && interactiveCount >= 2 && interactiveCount <= 12) return { container: ancestor, before };
    }
    return null;
  }

  function findHeaderMountTarget() {
    const roots = [...new Set([
      ...document.querySelectorAll("header, [role='banner'], [data-testid*='header']"),
      document
    ])];
    const newChatSelectors = [
      "[data-testid='create-new-chat-button']",
      "[data-testid='new-chat-button']",
      "button[aria-label*='new chat' i]",
      "a[aria-label*='new chat' i]",
      "button[aria-label*='새 채팅']",
      "a[aria-label*='새 채팅']"
    ];
    const planSelectors = [
      "[data-testid*='upgrade']",
      "[data-testid*='plan']",
      "a[href*='pricing']",
      "button[aria-label*='plus' i]",
      "a[aria-label*='plus' i]"
    ];
    const newChatPattern = /(?:new\s*chat|새\s*채팅|새로운\s*채팅)/i;
    const planPattern = /(?:chatgpt\s*)?(?:plus|pro)\b|플러스|업그레이드/i;

    for (const root of roots) {
      const newChat = findSemanticElement(root, newChatSelectors, newChatPattern);
      if (!newChat) continue;
      const plan = findSemanticElement(root, planSelectors, planPattern);
      const exact = commonMountTarget(plan, newChat);
      if (exact) return exact;
      if (root !== document) {
        const nearby = nearbyNewChatTarget(newChat, root);
        if (nearby) return nearby;
      }
    }
    return null;
  }

  function updateSummaryAria() {
    const action = state.settings.expanded ? "Codex 사용량 상세 닫기" : "Codex 사용량 상세 열기";
    const movement = state.layoutMode === "floating" ? " 드래그하여 이동할 수 있습니다." : "";
    elements.summary.setAttribute("aria-label", `${action}.${movement}`.trim());
  }

  function positionPopover() {
    if (!state.settings.expanded || elements.popover.hidden) return;
    const anchor = elements.summary.getBoundingClientRect();
    const popoverRect = elements.popover.getBoundingClientRect();
    const margin = 8;
    const width = Math.min(304, Math.max(240, window.innerWidth - margin * 2));
    const height = popoverRect.height || 480;
    const left = core.clamp(anchor.right - width, margin, Math.max(margin, window.innerWidth - width - margin));
    let top = anchor.bottom + 8;
    if (top + height > window.innerHeight - margin && anchor.top - height - 8 >= margin) top = anchor.top - height - 8;
    card.style.setProperty("--cub-popover-left", `${Math.round(left)}px`);
    card.style.setProperty("--cub-popover-top", `${Math.round(Math.max(margin, top))}px`);
    card.style.setProperty("--cub-popover-width", `${Math.round(width)}px`);
  }

  function mountIntegrated(target) {
    if (!target || !target.container || !target.before || !target.container.isConnected) return false;
    if (host.parentElement !== target.container || host.nextSibling !== target.before) {
      target.container.insertBefore(host, target.before);
    }
    state.layoutMode = "integrated";
    host.dataset.layout = "integrated";
    host.style.position = "relative";
    host.style.zIndex = "auto";
    host.style.left = "auto";
    host.style.top = "auto";
    host.style.width = "auto";
    host.style.height = "auto";
    host.style.visibility = "visible";
    updateSummaryAria();
    requestAnimationFrame(positionPopover);
    return true;
  }

  function mountFloating() {
    if (host.parentElement !== document.documentElement) document.documentElement.appendChild(host);
    state.layoutMode = "floating";
    host.dataset.layout = "floating";
    host.style.position = "fixed";
    host.style.zIndex = "2147483646";
    host.style.width = "max-content";
    host.style.height = "max-content";
    host.style.visibility = "visible";
    state.settings.position = applyPosition(state.settings.position);
    updateSummaryAria();
    requestAnimationFrame(positionPopover);
  }

  function ensureMounted() {
    state.mountTimer = null;
    state.lastMountAttemptAt = Date.now();
    const target = findHeaderMountTarget();
    if (!mountIntegrated(target)) mountFloating();
  }

  function scheduleMount(delay) {
    if (state.mountTimer) return;
    state.mountTimer = setTimeout(ensureMounted, delay || 80);
  }

  function setTopLayerVisible(element, visible) {
    if (!element) return;
    const supportsPopover = typeof element.showPopover === "function" && typeof element.hidePopover === "function";
    if (!supportsPopover) {
      element.hidden = !visible;
      return;
    }
    if (visible) {
      element.hidden = false;
      try {
        if (!element.matches(":popover-open")) element.showPopover();
      } catch (_error) {
        element.hidden = false;
      }
      return;
    }
    try {
      if (element.matches(":popover-open")) element.hidePopover();
    } catch (_error) {
      // hidden 속성 대체 경로를 계속 적용한다.
    }
    element.hidden = true;
  }

  function setExpanded(expanded, persist) {
    state.settings.expanded = Boolean(expanded);
    setTopLayerVisible(elements.popover, state.settings.expanded);
    elements.details.hidden = !state.settings.expanded;
    elements.summary.setAttribute("aria-expanded", String(state.settings.expanded));
    updateSummaryAria();
    card.classList.toggle("cub-expanded", state.settings.expanded);
    if (persist) saveSettings();
    requestAnimationFrame(() => {
      if (state.layoutMode === "floating") state.settings.position = applyPosition(state.settings.position);
      positionPopover();
      if (persist) saveSettings();
    });
  }

  function toneForRemaining(remaining) {
    if (remaining === null || remaining === undefined) return "neutral";
    if (remaining <= 15) return "danger";
    if (remaining <= 40) return "warning";
    return "healthy";
  }

  function setFill(element, remaining) {
    const value = core.clamp(Number(remaining) || 0, 0, 100);
    element.style.width = `${value}%`;
    element.dataset.tone = toneForRemaining(value);
  }

  function renderLimit(refs, windowData) {
    refs.row.hidden = !windowData;
    if (!windowData) return;
    refs.name.textContent = windowData.name;
    refs.value.textContent = `잔여 ${Math.round(windowData.remainingPercent)}%`;
    refs.used.textContent = `사용 ${Math.round(windowData.usedPercent)}%`;
    refs.reset.textContent = core.formatResetTime(windowData.resetAt);
    setFill(refs.fill, windowData.remainingPercent);
    refs.value.dataset.tone = toneForRemaining(windowData.remainingPercent);
  }

  function renderAdditional(additional) {
    elements.additional.replaceChildren();
    for (const entry of additional) {
      const windowData = entry.primary || entry.secondary;
      if (!windowData) continue;
      const row = document.createElement("div");
      row.className = "cub-limit cub-limit-additional";
      const head = document.createElement("div");
      head.className = "cub-limit-head";
      const label = document.createElement("span");
      label.textContent = entry.label;
      const value = document.createElement("strong");
      value.textContent = `잔여 ${Math.round(windowData.remainingPercent)}%`;
      value.dataset.tone = toneForRemaining(windowData.remainingPercent);
      const track = document.createElement("div");
      track.className = "cub-track";
      const fill = document.createElement("span");
      setFill(fill, windowData.remainingPercent);
      track.append(fill);
      const meta = document.createElement("div");
      meta.className = "cub-limit-meta";
      const used = document.createElement("span");
      used.textContent = `사용 ${Math.round(windowData.usedPercent)}%`;
      const reset = document.createElement("span");
      reset.textContent = core.formatResetTime(windowData.resetAt);
      meta.append(used, reset);
      head.append(label, value);
      row.append(head, track, meta);
      elements.additional.append(row);
    }
  }

  function renderCredits(credits, spendControl) {
    const values = [];
    if (credits.unlimited === true) values.push("무제한");
    else if (credits.balance !== null) values.push(`잔액 ${credits.balance}`);
    if (credits.resetCreditsAvailable !== null && credits.resetCreditsAvailable > 0) {
      values.push(`리셋권 ${credits.resetCreditsAvailable}개`);
    }
    if (spendControl && spendControl.remainingPercent !== null && spendControl.remainingPercent !== undefined) {
      values.push(`지출한도 잔여 ${Math.round(spendControl.remainingPercent)}%`);
    }
    elements.creditRow.hidden = values.length === 0;
    elements.creditValue.textContent = values.join(" · ");
    const resetCount = Number(credits.resetCreditsAvailable) || 0;
    elements.useReset.hidden = resetCount <= 0;
    elements.useReset.disabled = state.resetInFlight;
  }

  function renderWebStatus() {
    const status = state.webStatus;
    elements.webStatusGrid.replaceChildren();

    if (!status) {
      const tone = state.webStatusError ? "danger" : "neutral";
      const label = state.webStatusError || (state.webStatusLoading ? "확인 중" : "확인 불가");
      elements.webStatusIndicator.dataset.tone = tone;
      elements.webStatusOverall.dataset.tone = tone;
      elements.webStatusOverall.textContent = label;
      elements.serverDot.dataset.tone = tone;
      elements.serverDot.title = `ChatGPT 웹 상태: ${label}`;
      elements.serverDot.setAttribute("aria-label", `ChatGPT 웹 상태: ${label}`);
      elements.serverLabel.dataset.tone = tone;
      elements.serverLabel.textContent = label;
      elements.webStatusUpdated.textContent = state.webStatusLoading ? "상태 확인 중" : "상태 확인 실패";
      return;
    }

    elements.webStatusIndicator.dataset.tone = status.tone;
    elements.webStatusOverall.dataset.tone = status.tone;
    elements.webStatusOverall.textContent = status.overallLabel;
    elements.serverDot.dataset.tone = status.tone;
    elements.serverDot.title = `ChatGPT 웹 상태: ${status.overallLabel}`;
    elements.serverDot.setAttribute("aria-label", `ChatGPT 웹 상태: ${status.overallLabel}`);
    elements.serverLabel.dataset.tone = status.tone;
    elements.serverLabel.textContent = status.overallLabel;

    for (const component of status.components) {
      const row = document.createElement("div");
      row.className = "cub-web-status-item";
      const label = document.createElement("span");
      label.textContent = component.label;
      const value = document.createElement("span");
      value.className = "cub-web-status-value";
      value.dataset.tone = component.tone;
      const dot = document.createElement("i");
      dot.dataset.tone = component.tone;
      const text = document.createElement("span");
      text.textContent = component.statusLabel;
      value.append(dot, text);
      row.append(label, value);
      elements.webStatusGrid.append(row);
    }

    elements.webStatusUpdated.textContent = status.updatedAt
      ? `${new Intl.DateTimeFormat("ko-KR", { hour: "2-digit", minute: "2-digit", hour12: false }).format(new Date(status.updatedAt))} 상태 기준`
      : "현재 상태";
  }

  function renderStatus() {
    if (state.error) {
      elements.statusBanner.hidden = false;
      elements.statusBanner.dataset.tone = "danger";
      elements.statusBanner.textContent = state.error;
    } else if (state.loading && state.usage) {
      elements.statusBanner.hidden = false;
      elements.statusBanner.dataset.tone = "neutral";
      elements.statusBanner.textContent = "사용량을 다시 확인하고 있습니다.";
    } else {
      elements.statusBanner.hidden = true;
      elements.statusBanner.textContent = "";
    }
  }

  function render() {
    const usage = state.usage;
    if (!usage) {
      elements.plan.textContent = state.error ? "확인 필요" : "확인 중";
      elements.summaryValue.textContent = state.loading ? "…" : "—";
      elements.summaryValue.dataset.tone = state.error ? "danger" : "neutral";
      setFill(elements.summaryFill, 0);
      elements.primary.row.hidden = true;
      elements.secondary.row.hidden = true;
      elements.creditRow.hidden = true;
      elements.useReset.hidden = true;
      elements.additional.replaceChildren();
    } else {
      const compact = usage.primary || usage.secondary || (usage.additional[0] && (usage.additional[0].primary || usage.additional[0].secondary));
      elements.plan.textContent = usage.planLabel;
      if (compact) {
        const remaining = Math.round(compact.remainingPercent);
        elements.summaryValue.textContent = `${remaining}%`;
        elements.summaryValue.dataset.tone = toneForRemaining(remaining);
        setFill(elements.summaryFill, remaining);
      } else {
        elements.summaryValue.textContent = "—";
        elements.summaryValue.dataset.tone = "neutral";
        setFill(elements.summaryFill, 0);
      }
      renderLimit(elements.primary, usage.primary);
      renderLimit(elements.secondary, usage.secondary);
      renderAdditional(usage.additional);
      renderCredits(usage.credits, usage.spendControl);
    }

    elements.refresh.classList.toggle("cub-spinning", state.loading);
    elements.refresh.disabled = state.loading;
    elements.updated.textContent = state.lastUpdatedAt
      ? `${new Intl.DateTimeFormat("ko-KR", { hour: "2-digit", minute: "2-digit", second: "2-digit", hour12: false }).format(state.lastUpdatedAt)} 확인`
      : state.loading ? "확인 중" : "확인 전";
    renderStatus();
    renderWebStatus();
  }

  function syncResetPromptPolicy(usage) {
    const key = core.resetWindowKey(usage);
    const remaining = usage && usage.primary ? Number(usage.primary.remainingPercent) : null;
    let changed = false;
    const clear = (name) => {
      if (state.settings[name] !== null) {
        state.settings[name] = null;
        changed = true;
      }
    };

    if (!key || !Number.isFinite(remaining) || remaining > 5) {
      clear("resetPromptSnoozedWindowKey");
      clear("resetPromptSnoozeUntil");
      clear("resetPromptSuppressUntilZeroWindowKey");
    } else {
      if (state.settings.resetPromptSnoozedWindowKey && state.settings.resetPromptSnoozedWindowKey !== key) {
        clear("resetPromptSnoozedWindowKey");
        clear("resetPromptSnoozeUntil");
      }
      if (state.settings.resetPromptSuppressUntilZeroWindowKey && state.settings.resetPromptSuppressUntilZeroWindowKey !== key) {
        clear("resetPromptSuppressUntilZeroWindowKey");
      }
    }
    if (changed) saveSettings();
  }

  function openResetDialog(source) {
    clearTimeout(state.resetOfferTimer);
    state.resetOfferTimer = null;
    const usage = state.usage;
    const count = Number(usage && usage.credits && usage.credits.resetCreditsAvailable) || 0;
    if (!usage || !usage.primary || count <= 0) return;
    const remaining = Math.round(usage.primary.remainingPercent);
    elements.resetRemaining.textContent = `5시간 잔여 ${remaining}%`;
    elements.resetCount.textContent = `초기화권 ${count}개 보유`;
    elements.resetResult.hidden = true;
    elements.resetResult.textContent = "";
    elements.resetResult.dataset.tone = "neutral";
    elements.resetConfirm.hidden = false;
    elements.resetConfirm.textContent = "초기화권 사용";
    elements.resetConfirm.disabled = false;
    elements.resetSuppress.hidden = remaining <= 0;
    elements.resetSuppress.disabled = false;
    elements.resetLater.disabled = false;
    elements.resetLater.textContent = "나중에 (30분 후)";
    elements.resetDialog.dataset.source = source || "manual";
    elements.resetDialog.dataset.terminal = "false";
    setTopLayerVisible(elements.resetDialog, true);
    requestAnimationFrame(() => elements.resetConfirm.focus());
  }

  function closeResetDialog() {
    if (state.resetInFlight) return;
    setTopLayerVisible(elements.resetDialog, false);
    if (!elements.useReset.hidden) elements.useReset.focus();
  }

  function snoozeResetPrompt() {
    if (state.resetInFlight) return;
    if (elements.resetDialog.dataset.terminal === "true") {
      closeResetDialog();
      return;
    }
    const key = core.resetWindowKey(state.usage);
    if (key) {
      state.settings.resetPromptSnoozedWindowKey = key;
      state.settings.resetPromptSnoozeUntil = Date.now() + RESET_PROMPT_SNOOZE_MS;
      saveSettings();
    }
    closeResetDialog();
  }

  function suppressResetPromptUntilZero() {
    if (state.resetInFlight) return;
    const key = core.resetWindowKey(state.usage);
    if (!key) return;
    state.settings.resetPromptSuppressUntilZeroWindowKey = key;
    state.settings.resetPromptSnoozedWindowKey = null;
    state.settings.resetPromptSnoozeUntil = null;
    saveSettings();
    closeResetDialog();
  }

  function maybeOfferResetCredit(usage) {
    syncResetPromptPolicy(usage);
    const decision = core.evaluateResetPrompt(usage, state.settings, Date.now());
    if (!decision.shouldOffer || !elements.resetDialog.hidden || state.resetOfferTimer) return;
    if (decision.reason === "zero-reached") {
      state.settings.resetPromptSuppressUntilZeroWindowKey = null;
      state.settings.resetPromptSnoozedWindowKey = null;
      state.settings.resetPromptSnoozeUntil = null;
      saveSettings();
    }
    state.resetOfferTimer = setTimeout(() => openResetDialog("automatic"), 500);
  }

  function setResetResult(message, tone) {
    elements.resetResult.hidden = false;
    elements.resetResult.textContent = message;
    elements.resetResult.dataset.tone = tone || "neutral";
  }

  function consumeResetCredit() {
    if (state.resetInFlight) return;
    const requestId = `reset-${Date.now().toString(36)}-${Math.random().toString(36).slice(2)}`;
    const redeemRequestId = globalThis.crypto && typeof globalThis.crypto.randomUUID === "function"
      ? globalThis.crypto.randomUUID()
      : `${Date.now().toString(36)}-${Math.random().toString(36).slice(2)}-${Math.random().toString(36).slice(2)}`;
    state.activeResetRequestId = requestId;
    state.resetInFlight = true;
    elements.resetConfirm.disabled = true;
    elements.resetSuppress.disabled = true;
    elements.resetLater.disabled = true;
    elements.resetConfirm.textContent = "사용 중…";
    setResetResult("초기화권 사용 요청을 처리하고 있습니다.", "neutral");
    clearTimeout(state.resetRequestTimeout);
    state.resetRequestTimeout = setTimeout(() => {
      if (state.activeResetRequestId !== requestId) return;
      state.resetInFlight = false;
      elements.resetConfirm.disabled = false;
      elements.resetSuppress.disabled = false;
      elements.resetLater.disabled = false;
      elements.resetConfirm.textContent = "다시 시도";
      setResetResult("초기화 요청 응답이 지연되고 있습니다. 같은 버튼을 연속으로 누르지 말고 잠시 후 사용량을 확인해 주세요.", "warning");
      render();
    }, 20_000);
    render();
    window.dispatchEvent(new CustomEvent(REQUEST_EVENT, {
      detail: JSON.stringify({
        requestId,
        action: "consume-reset",
        redeemRequestId
      })
    }));
  }

  function handleResetResponse(detail) {
    clearTimeout(state.resetRequestTimeout);
    state.resetInFlight = false;
    elements.resetConfirm.disabled = false;
    elements.resetSuppress.disabled = false;
    elements.resetLater.disabled = false;
    elements.resetConfirm.textContent = "초기화권 사용";

    if (!detail.ok) {
      setResetResult(detail.error && detail.error.message
        ? detail.error.message
        : "초기화권을 사용하지 못했습니다.", "danger");
      render();
      return;
    }

    const messages = {
      reset: `${detail.windowsReset || 1}개 사용량 창을 초기화했습니다.`,
      nothing_to_reset: "현재 초기화할 사용량 창이 없습니다.",
      no_credit: "사용 가능한 초기화권이 없습니다.",
      already_redeemed: "이 초기화 요청은 이미 처리됐습니다."
    };
    const resetCompleted = detail.outcome === "reset";
    const terminal = resetCompleted || detail.outcome === "already_redeemed";
    setResetResult(messages[detail.outcome] || "초기화 요청이 처리됐습니다.", terminal ? "healthy" : "warning");
    elements.resetConfirm.hidden = terminal;
    elements.resetSuppress.hidden = terminal || Math.round(state.usage && state.usage.primary
      ? state.usage.primary.remainingPercent
      : 0) <= 0;
    elements.resetLater.textContent = terminal ? "닫기" : "나중에 (30분 후)";
    elements.resetDialog.dataset.terminal = String(terminal);
    if (resetCompleted && state.usage && state.usage.credits) {
      const count = Number(state.usage.credits.resetCreditsAvailable) || 0;
      state.usage.credits.resetCreditsAvailable = Math.max(0, count - 1);
    }
    if (terminal) setTimeout(() => refreshUsage("reset-complete"), 1200);
    render();
  }

  function refreshUsage(reason) {
    if (document.visibilityState === "hidden" && reason !== "manual") return;
    if (reason === "manual") {
      clearTimeout(state.recoveryTimer);
      state.recoveryTimer = null;
      state.recoveryAttempts = 0;
    }
    const requestId = `${Date.now().toString(36)}-${Math.random().toString(36).slice(2)}`;
    state.activeRequestId = requestId;
    state.loading = true;
    state.error = null;
    clearTimeout(state.requestTimeout);
    state.requestTimeout = setTimeout(() => {
      if (state.activeRequestId !== requestId) return;
      state.loading = false;
      state.error = "사용량 응답이 지연되고 있습니다. 잠시 후 다시 시도해 주세요.";
      render();
      scheduleUsageRecovery();
    }, 15_000);
    render();
    window.dispatchEvent(new CustomEvent(REQUEST_EVENT, {
      detail: JSON.stringify({ requestId, reason })
    }));
  }

  async function refreshWebStatus(force) {
    if (document.visibilityState === "hidden" && !force) return;
    state.webStatusLoading = true;
    state.webStatusError = null;
    renderWebStatus();
    try {
      const result = await chrome.runtime.sendMessage({
        type: "codex-usage-bar:fetch-chatgpt-status",
        force: Boolean(force)
      });
      state.webStatusLoading = false;
      if (result && result.ok && result.status) {
        state.webStatus = result.status;
        state.webStatusError = null;
      } else {
        state.webStatusError = result && result.error ? result.error : "상태 확인 실패";
      }
    } catch (_error) {
      state.webStatusLoading = false;
      state.webStatusError = "상태 확인 실패";
    }
    renderWebStatus();
  }

  function refreshAll(reason, forceStatus) {
    refreshUsage(reason);
    refreshWebStatus(Boolean(forceStatus));
  }

  function scheduleUsageRecovery() {
    if (state.usage || state.recoveryTimer || state.recoveryAttempts >= 2) return;
    const delay = state.recoveryAttempts === 0 ? 3_000 : 7_000;
    state.recoveryAttempts += 1;
    state.recoveryTimer = setTimeout(() => {
      state.recoveryTimer = null;
      if (!state.usage) refreshUsage("automatic-recovery");
    }, delay);
  }

  window.addEventListener(RESPONSE_EVENT, (event) => {
    let detail = event && event.detail;
    if (typeof detail === "string") {
      try {
        detail = JSON.parse(detail);
      } catch (_error) {
        return;
      }
    }
    if (!detail) return;
    if (detail.requestId === state.activeResetRequestId) {
      handleResetResponse(detail);
      return;
    }
    if (detail.requestId !== state.activeRequestId) return;
    clearTimeout(state.requestTimeout);
    state.loading = false;
    if (detail.ok) {
      const normalized = core.normalizeUsage(detail.data);
      if (normalized.hasUsageData) {
        clearTimeout(state.recoveryTimer);
        state.recoveryTimer = null;
        state.recoveryAttempts = 0;
        state.usage = normalized;
        state.error = null;
        state.lastUpdatedAt = new Date(detail.fetchedAt || Date.now());
        state.endpoint = detail.endpoint || null;
        maybeOfferResetCredit(normalized);
      } else {
        state.error = "계정에서 표시 가능한 Codex 한도를 찾지 못했습니다.";
        scheduleUsageRecovery();
      }
    } else {
      state.error = detail.error && detail.error.message
        ? detail.error.message
        : "Codex 사용량을 가져오지 못했습니다.";
      scheduleUsageRecovery();
    }
    render();
  });

  function restartPolling() {
    clearInterval(state.pollTimer);
    const interval = Number(state.settings.pollIntervalSeconds) * 1000;
    state.pollTimer = setInterval(() => refreshAll("interval", false), interval);
  }

  function scheduleActivityRefresh(delay) {
    clearTimeout(state.activityTimer);
    state.activityTimer = setTimeout(() => refreshUsage("answer-complete"), delay || 3000);
  }

  function isInsideWidget(node) {
    return node === host || (node && typeof node.getRootNode === "function" && node.getRootNode() === shadow);
  }

  function mutationTouchesAssistant(mutation) {
    const candidates = [mutation.target, ...mutation.addedNodes];
    return candidates.some((node) => {
      if (!(node instanceof Element) && !(node instanceof Text)) return false;
      const element = node instanceof Text ? node.parentElement : node;
      if (!element || isInsideWidget(element)) return false;
      return Boolean(element.closest && element.closest('[data-message-author-role="assistant"], [data-testid*="assistant"], article'));
    });
  }

  function detectGenerationActive() {
    const selectors = [
      'button[data-testid="stop-button"]',
      'button[aria-label*="Stop"]',
      'button[aria-label*="중지"]',
      'button[title*="Stop"]',
      'button[title*="중지"]'
    ];
    return selectors.some((selector) => document.querySelector(selector));
  }

  function checkGenerationTransition() {
    state.generationCheckTimer = null;
    const active = detectGenerationActive();
    if (state.generationActive && !active) scheduleActivityRefresh(1800);
    state.generationActive = active;
  }

  const observer = new MutationObserver((mutations) => {
    if (!host.isConnected) scheduleMount(0);
    else if (state.layoutMode === "floating" && Date.now() - state.lastMountAttemptAt > 2_000) scheduleMount(120);
    else if (state.layoutMode === "integrated" && Date.now() - state.lastMountAttemptAt > 2_000) scheduleMount(180);
    if (mutations.some(mutationTouchesAssistant)) scheduleActivityRefresh(3200);
    if (!state.generationCheckTimer) {
      state.generationCheckTimer = setTimeout(checkGenerationTransition, 350);
    }
  });
  observer.observe(document.documentElement, { childList: true, subtree: true, characterData: true });

  document.addEventListener("submit", (event) => {
    if (isInsideWidget(event.target)) return;
    scheduleActivityRefresh(12_000);
  }, true);

  document.addEventListener("click", (event) => {
    if (isInsideWidget(event.target)) return;
    if (state.settings.expanded) setExpanded(false, true);
    const target = event.target instanceof Element ? event.target.closest("button") : null;
    if (!target) return;
    const label = `${target.getAttribute("aria-label") || ""} ${target.getAttribute("data-testid") || ""}`.toLowerCase();
    if (label.includes("send") || label.includes("전송") || label.includes("submit")) scheduleActivityRefresh(12_000);
  }, true);

  document.addEventListener("visibilitychange", () => {
    if (document.visibilityState === "visible") refreshAll("visible", false);
  });
  window.addEventListener("focus", () => refreshAll("focus", false));
  window.addEventListener("resize", () => {
    if (state.layoutMode === "floating") {
      state.settings.position = applyPosition(state.settings.position);
      saveSettings();
    }
    positionPopover();
  });
  window.addEventListener("scroll", positionPopover, true);

  function toggleExpanded() {
    if (state.movedDuringDrag) return;
    setExpanded(!state.settings.expanded, true);
  }

  elements.summary.addEventListener("click", (event) => {
    if (event.target.closest("button")) return;
    toggleExpanded();
  });
  elements.toggle.addEventListener("click", (event) => {
    event.stopPropagation();
    toggleExpanded();
  });
  elements.summary.addEventListener("keydown", (event) => {
    if (event.key === "Enter" || event.key === " ") {
      event.preventDefault();
      toggleExpanded();
      return;
    }
    if (state.layoutMode !== "floating") return;
    const movement = event.shiftKey ? 1 : 10;
    const position = state.settings.position || defaultPosition();
    if (event.key === "ArrowLeft") position.x -= movement;
    else if (event.key === "ArrowRight") position.x += movement;
    else if (event.key === "ArrowUp") position.y -= movement;
    else if (event.key === "ArrowDown") position.y += movement;
    else return;
    event.preventDefault();
    state.settings.position = applyPosition(position);
    saveSettings();
  });

  let dragStart = null;
  elements.summary.addEventListener("pointerdown", (event) => {
    if (state.layoutMode !== "floating" || event.button !== 0 || event.target.closest("button")) return;
    const rect = host.getBoundingClientRect();
    dragStart = { pointerX: event.clientX, pointerY: event.clientY, x: rect.left, y: rect.top };
    state.dragging = true;
    state.movedDuringDrag = false;
    card.classList.add("cub-dragging");
    elements.summary.setPointerCapture(event.pointerId);
  });
  elements.summary.addEventListener("pointermove", (event) => {
    if (!state.dragging || !dragStart) return;
    const dx = event.clientX - dragStart.pointerX;
    const dy = event.clientY - dragStart.pointerY;
    if (Math.hypot(dx, dy) > 4) state.movedDuringDrag = true;
    state.settings.position = applyPosition({ x: dragStart.x + dx, y: dragStart.y + dy });
    event.preventDefault();
  });
  function finishDrag(event) {
    if (!state.dragging) return;
    state.dragging = false;
    card.classList.remove("cub-dragging");
    if (elements.summary.hasPointerCapture(event.pointerId)) elements.summary.releasePointerCapture(event.pointerId);
    saveSettings();
    if (state.movedDuringDrag) setTimeout(() => { state.movedDuringDrag = false; }, 0);
    dragStart = null;
  }
  elements.summary.addEventListener("pointerup", finishDrag);
  elements.summary.addEventListener("pointercancel", finishDrag);

  elements.refresh.addEventListener("click", () => refreshAll("manual", true));
  elements.useReset.addEventListener("click", () => openResetDialog("manual"));
  elements.resetConfirm.addEventListener("click", consumeResetCredit);
  elements.resetSuppress.addEventListener("click", suppressResetPromptUntilZero);
  elements.resetLater.addEventListener("click", snoozeResetPrompt);
  elements.resetDialog.addEventListener("click", (event) => {
    if (event.target === elements.resetDialog) snoozeResetPrompt();
  });
  shadow.addEventListener("keydown", (event) => {
    if (event.key === "Escape" && !elements.resetDialog.hidden) {
      event.preventDefault();
      snoozeResetPrompt();
    } else if (event.key === "Escape" && state.settings.expanded) {
      event.preventDefault();
      setExpanded(false, true);
      elements.summary.focus();
    }
  });
  elements.settingsButton.addEventListener("click", () => {
    elements.settings.hidden = !elements.settings.hidden;
    requestAnimationFrame(() => {
      state.settings.position = applyPosition(state.settings.position);
      saveSettings();
    });
  });
  elements.interval.addEventListener("change", () => {
    state.settings.pollIntervalSeconds = Number(elements.interval.value);
    saveSettings();
    restartPolling();
  });
  elements.resetPosition.addEventListener("click", () => {
    if (state.layoutMode !== "floating") return;
    state.settings.position = applyPosition(defaultPosition());
    saveSettings();
  });

  await loadSettings();
  elements.interval.value = String(state.settings.pollIntervalSeconds);
  ensureMounted();
  setExpanded(state.settings.expanded, false);
  requestAnimationFrame(() => {
    if (state.layoutMode === "floating") {
      state.settings.position = applyPosition(state.settings.position);
      saveSettings();
    }
    positionPopover();
  });
  restartPolling();
  render();
  refreshAll("initial", true);
})();
