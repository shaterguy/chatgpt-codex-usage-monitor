(function installCodexUsageBridge() {
  "use strict";

  if (window.__codexUsageBarBridgeInstalled) return;
  Object.defineProperty(window, "__codexUsageBarBridgeInstalled", {
    value: true,
    configurable: false,
    enumerable: false,
    writable: false
  });

  const REQUEST_EVENT = "codex-usage-bar:request";
  const RESPONSE_EVENT = "codex-usage-bar:response";
  const USAGE_ENDPOINT = "/backend-api/wham/usage";
  const RESET_ENDPOINT = "/backend-api/wham/rate-limit-reset-credits/consume";
  const REQUEST_TIMEOUT_MS = 4_500;
  const MINIMUM_REQUEST_GAP_MS = 2500;
  let inFlight = null;
  let lastFinishedAt = 0;
  let lastResult = null;

  function dispatch(requestId, result, fromCache) {
    window.dispatchEvent(new CustomEvent(RESPONSE_EVENT, {
      detail: JSON.stringify({
        requestId,
        fromCache: Boolean(fromCache),
        fetchedAt: Date.now(),
        ...result
      })
    }));
  }

  function parseEventDetail(event) {
    if (!event) return null;
    if (typeof event.detail === "string") {
      try {
        return JSON.parse(event.detail);
      } catch (_error) {
        return null;
      }
    }
    return event.detail && typeof event.detail === "object" ? event.detail : null;
  }

  function decodeJwtPayload(token) {
    if (typeof token !== "string") return null;
    const parts = token.split(".");
    if (parts.length < 2) return null;
    try {
      const normalized = parts[1].replace(/-/g, "+").replace(/_/g, "/");
      const padding = "=".repeat((4 - normalized.length % 4) % 4);
      const binary = atob(normalized + padding);
      const bytes = Uint8Array.from(binary, (character) => character.charCodeAt(0));
      return JSON.parse(new TextDecoder().decode(bytes));
    } catch (_error) {
      return null;
    }
  }

  function valueAt(object, path) {
    return path.reduce((value, key) => value && typeof value === "object" ? value[key] : undefined, object);
  }

  function extractAccountId(session, token) {
    const paths = [
      ["account", "id"],
      ["activeAccount", "id"],
      ["user", "account", "id"],
      ["user", "account_id"],
      ["accountId"],
      ["activeAccountId"]
    ];
    for (const path of paths) {
      const value = valueAt(session, path);
      if (typeof value === "string" && value) return value;
    }

    const claims = decodeJwtPayload(token);
    const auth = claims && claims["https://api.openai.com/auth"];
    const candidates = [
      auth && auth.chatgpt_account_id,
      claims && claims.chatgpt_account_id,
      claims && claims.account_id
    ];
    return candidates.find((value) => typeof value === "string" && value) || null;
  }

  async function fetchWithTimeout(url, options) {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);
    try {
      return await fetch(url, { ...options, signal: controller.signal });
    } finally {
      clearTimeout(timeout);
    }
  }

  async function readSession() {
    const response = await fetchWithTimeout("/api/auth/session", {
      credentials: "include",
      cache: "no-store",
      headers: { Accept: "application/json" }
    });
    if (!response.ok) return null;
    const session = await response.json().catch(() => null);
    if (!session || typeof session !== "object") return null;
    const accessToken = session.accessToken || session.access_token || null;
    return {
      accessToken,
      accountId: extractAccountId(session, accessToken)
    };
  }

  async function attemptEndpoint(endpoint, auth) {
    const headers = {
      Accept: "application/json",
      "Cache-Control": "no-cache"
    };
    if (auth && auth.accessToken) headers.Authorization = `Bearer ${auth.accessToken}`;
    if (auth && auth.accountId) headers["ChatGPT-Account-Id"] = auth.accountId;

    const response = await fetchWithTimeout(endpoint, {
      method: "GET",
      credentials: "include",
      cache: "no-store",
      headers
    });

    if (!response.ok) return { ok: false, status: response.status, endpoint };
    const data = await response.json().catch(() => null);
    if (!data || typeof data !== "object") return { ok: false, status: 502, endpoint };
    return { ok: true, data, endpoint };
  }

  async function fetchUsage() {
    const statuses = [];
    const sessionPromise = readSession().catch(() => null);

    try {
      const result = await attemptEndpoint(USAGE_ENDPOINT, null);
      if (result.ok) return result;
      statuses.push(result.status);
    } catch (_error) {
      statuses.push(0);
    }

    const auth = await sessionPromise;

    if (auth && auth.accessToken) {
      try {
        const result = await attemptEndpoint(USAGE_ENDPOINT, auth);
        if (result.ok) return result;
        statuses.push(result.status);
      } catch (_error) {
        statuses.push(0);
      }
    }

    const unauthenticated = statuses.some((status) => status === 401 || status === 403) && !(auth && auth.accessToken);
    return {
      ok: false,
      error: {
        code: unauthenticated ? "not_authenticated" : "usage_unavailable",
        message: unauthenticated
          ? "ChatGPT 로그인 상태를 확인해 주세요."
          : "Codex 사용량을 가져오지 못했습니다.",
        statuses: [...new Set(statuses.filter(Boolean))]
      }
    };
  }

  async function attemptResetEndpoint(endpoint, auth, redeemRequestId) {
    const headers = {
      Accept: "application/json",
      "Cache-Control": "no-cache",
      "Content-Type": "application/json"
    };
    if (auth && auth.accessToken) headers.Authorization = `Bearer ${auth.accessToken}`;
    if (auth && auth.accountId) headers["ChatGPT-Account-Id"] = auth.accountId;

    const response = await fetchWithTimeout(endpoint, {
      method: "POST",
      credentials: "include",
      cache: "no-store",
      headers,
      body: JSON.stringify({ redeem_request_id: redeemRequestId })
    });

    if (!response.ok) return { ok: false, status: response.status, endpoint };
    const data = await response.json().catch(() => null);
    if (!data || typeof data.code !== "string") return { ok: false, status: 502, endpoint };
    return {
      ok: true,
      endpoint,
      outcome: data.code,
      windowsReset: Number.isFinite(Number(data.windows_reset)) ? Number(data.windows_reset) : 0
    };
  }

  async function consumeResetCredit(redeemRequestId) {
    const statuses = [];
    const sessionPromise = readSession().catch(() => null);

    try {
      const result = await attemptResetEndpoint(RESET_ENDPOINT, null, redeemRequestId);
      if (result.ok) return result;
      statuses.push(result.status);
    } catch (_error) {
      statuses.push(0);
    }

    const auth = await sessionPromise;

    if (auth && auth.accessToken) {
      try {
        const result = await attemptResetEndpoint(RESET_ENDPOINT, auth, redeemRequestId);
        if (result.ok) return result;
        statuses.push(result.status);
      } catch (_error) {
        statuses.push(0);
      }
    }

    const unauthenticated = statuses.some((status) => status === 401 || status === 403) && !(auth && auth.accessToken);
    return {
      ok: false,
      error: {
        code: unauthenticated ? "not_authenticated" : "reset_unavailable",
        message: unauthenticated
          ? "ChatGPT 로그인 상태를 확인해 주세요."
          : "초기화권을 사용하지 못했습니다. 잠시 후 다시 시도해 주세요.",
        statuses: [...new Set(statuses.filter(Boolean))]
      }
    };
  }

  window.addEventListener(REQUEST_EVENT, async (event) => {
    const request = parseEventDetail(event);
    const requestId = request && request.requestId;
    if (typeof requestId !== "string" || !requestId) return;

    if (request.action === "consume-reset") {
      const redeemRequestId = request.redeemRequestId;
      if (typeof redeemRequestId !== "string" || !redeemRequestId.trim() || redeemRequestId.length > 200) {
        dispatch(requestId, {
          ok: false,
          error: { code: "invalid_reset_request", message: "유효하지 않은 초기화 요청입니다." }
        }, false);
        return;
      }
      const result = await consumeResetCredit(redeemRequestId);
      if (result.ok) {
        lastResult = null;
        lastFinishedAt = 0;
      }
      dispatch(requestId, result, false);
      return;
    }

    const now = Date.now();
    if (lastResult && now - lastFinishedAt < MINIMUM_REQUEST_GAP_MS) {
      dispatch(requestId, lastResult, true);
      return;
    }

    if (!inFlight) {
      inFlight = fetchUsage()
        .then((result) => {
          lastResult = result;
          lastFinishedAt = Date.now();
          return result;
        })
        .catch(() => ({
          ok: false,
          error: { code: "bridge_error", message: "사용량 조회 중 오류가 발생했습니다." }
        }))
        .finally(() => {
          inFlight = null;
        });
    }

    dispatch(requestId, await inFlight, false);
  });
})();
