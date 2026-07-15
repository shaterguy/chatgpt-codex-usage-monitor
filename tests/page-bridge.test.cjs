"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const vm = require("node:vm");

const bridgeSource = fs.readFileSync(require.resolve("../src/page-bridge.js"), "utf8");

class FakeCustomEvent {
  constructor(type, options) {
    this.type = type;
    this.detail = options && options.detail;
  }
}

class FakeWindow {
  constructor() {
    this.listeners = new Map();
  }

  addEventListener(type, listener) {
    const listeners = this.listeners.get(type) || [];
    listeners.push(listener);
    this.listeners.set(type, listeners);
  }

  dispatchEvent(event) {
    for (const listener of this.listeners.get(event.type) || []) listener(event);
    return true;
  }
}

function response(status, data) {
  return {
    ok: status >= 200 && status < 300,
    status,
    json: async () => data
  };
}

function installBridge(fetchImplementation, timerOverrides) {
  const window = new FakeWindow();
  const context = vm.createContext({
    window,
    fetch: fetchImplementation,
    CustomEvent: FakeCustomEvent,
    TextDecoder,
    Uint8Array,
    atob,
    Date,
    JSON,
    Object,
    Promise,
    Set,
    AbortController,
    setTimeout: timerOverrides && timerOverrides.setTimeout || setTimeout,
    clearTimeout: timerOverrides && timerOverrides.clearTimeout || clearTimeout
  });
  vm.runInContext(bridgeSource, context);
  return window;
}

function requestBridge(window, id, payload) {
  return new Promise((resolve) => {
    window.addEventListener("codex-usage-bar:response", (event) => {
      const detail = JSON.parse(event.detail);
      if (detail.requestId === id) resolve(detail);
    });
    window.dispatchEvent(new FakeCustomEvent("codex-usage-bar:request", {
      detail: JSON.stringify({ requestId: id, reason: "test", ...(payload || {}) })
    }));
  });
}

function requestUsage(window, id) {
  return requestBridge(window, id);
}

function jwt(payload) {
  const encode = (value) => Buffer.from(JSON.stringify(value)).toString("base64url");
  return `${encode({ alg: "none" })}.${encode(payload)}.signature`;
}

test("uses the current ChatGPT page session without storing credentials", async () => {
  const requests = [];
  const window = installBridge(async (url, options) => {
    requests.push({ url, options });
    if (url === "/backend-api/wham/usage") {
      return response(200, {
        plan_type: "plus",
        rate_limit: { primary_window: { used_percent: 25 } }
      });
    }
    return response(404, {});
  });

  const result = await requestUsage(window, "cookie-success");
  assert.equal(result.ok, true);
  assert.equal(result.endpoint, "/backend-api/wham/usage");
  assert.equal(result.data.rate_limit.primary_window.used_percent, 25);
  const usageRequest = requests.find((entry) => entry.url === "/backend-api/wham/usage");
  assert.ok(usageRequest);
  assert.equal(usageRequest.options.credentials, "include");
  assert.equal(usageRequest.options.headers.Authorization, undefined);
});

test("falls back to the in-memory session token and selected account header", async () => {
  const requests = [];
  const accessToken = jwt({
    "https://api.openai.com/auth": { chatgpt_account_id: "account-current" }
  });
  const window = installBridge(async (url, options) => {
    requests.push({ url, options });
    if (url === "/api/auth/session") return response(200, { accessToken });
    if (url === "/backend-api/wham/usage" && options.headers.Authorization) {
      return response(200, {
        plan_type: "pro",
        rate_limit: { primary_window: { used_percent: 40 } }
      });
    }
    return response(401, {});
  });

  const result = await requestUsage(window, "auth-fallback");
  assert.equal(result.ok, true);
  const authenticated = requests.find((entry) => entry.options.headers.Authorization);
  assert.ok(authenticated);
  assert.equal(authenticated.options.headers.Authorization, `Bearer ${accessToken}`);
  assert.equal(authenticated.options.headers["ChatGPT-Account-Id"], "account-current");
});

test("returns a clear login error when no authenticated session exists", async () => {
  const window = installBridge(async (url) => {
    if (url === "/api/auth/session") return response(200, {});
    return response(401, {});
  });
  const result = await requestUsage(window, "not-logged-in");
  assert.equal(result.ok, false);
  assert.equal(result.error.code, "not_authenticated");
  assert.match(result.error.message, /로그인/);
});

test("recovers through the authenticated official endpoint when a cookie request stalls", async () => {
  const requests = [];
  const accessToken = jwt({
    "https://api.openai.com/auth": { chatgpt_account_id: "account-current" }
  });
  const timers = {
    setTimeout(callback) {
      const handle = { cancelled: false };
      queueMicrotask(() => { if (!handle.cancelled) callback(); });
      return handle;
    },
    clearTimeout(handle) {
      if (handle) handle.cancelled = true;
    }
  };
  const window = installBridge(async (url, options) => {
    requests.push({ url, options });
    if (url === "/api/auth/session") return response(200, { accessToken });
    if (url === "/backend-api/wham/usage" && options.headers.Authorization) {
      return response(200, {
        plan_type: "plus",
        rate_limit: { primary_window: { used_percent: 55 } }
      });
    }
    if (url === "/backend-api/wham/usage") {
      return new Promise((_resolve, reject) => {
        options.signal.addEventListener("abort", () => {
          const error = new Error("aborted");
          error.name = "AbortError";
          reject(error);
        });
      });
    }
    return response(404, {});
  }, timers);

  const result = await requestUsage(window, "stalled-cookie");
  assert.equal(result.ok, true);
  assert.equal(result.endpoint, "/backend-api/wham/usage");
  assert.equal(result.data.rate_limit.primary_window.used_percent, 55);
  assert.equal(requests.some((entry) => entry.url === "/backend-api/codex/usage"), false);
});

test("consumes a reset credit with an idempotent redeem request", async () => {
  const requests = [];
  const window = installBridge(async (url, options) => {
    requests.push({ url, options });
    if (url === "/backend-api/wham/rate-limit-reset-credits/consume") {
      return response(200, { code: "reset", windows_reset: 2 });
    }
    return response(404, {});
  });

  const result = await requestBridge(window, "consume-1", {
    action: "consume-reset",
    redeemRequestId: "reset-idempotency-123"
  });
  assert.equal(result.ok, true);
  assert.equal(result.outcome, "reset");
  assert.equal(result.windowsReset, 2);
  const resetRequest = requests.find((entry) => entry.url.includes("rate-limit-reset-credits/consume"));
  assert.ok(resetRequest);
  assert.equal(resetRequest.options.method, "POST");
  assert.equal(resetRequest.options.headers["Content-Type"], "application/json");
  assert.deepEqual(JSON.parse(resetRequest.options.body), {
    redeem_request_id: "reset-idempotency-123"
  });
});

test("uses the same reset id when authenticated fallback is required", async () => {
  const requests = [];
  const accessToken = jwt({
    "https://api.openai.com/auth": { chatgpt_account_id: "account-current" }
  });
  const window = installBridge(async (url, options) => {
    requests.push({ url, options });
    if (url === "/api/auth/session") return response(200, { accessToken });
    if (url.includes("rate-limit-reset-credits/consume") && options.headers.Authorization) {
      return response(200, { code: "reset", windows_reset: 1 });
    }
    return response(401, {});
  });

  const result = await requestBridge(window, "consume-auth", {
    action: "consume-reset",
    redeemRequestId: "stable-reset-id"
  });
  assert.equal(result.ok, true);
  const resetRequests = requests.filter((entry) => entry.url.includes("rate-limit-reset-credits/consume"));
  assert.equal(resetRequests.length, 2);
  for (const entry of resetRequests) {
    assert.equal(JSON.parse(entry.options.body).redeem_request_id, "stable-reset-id");
  }
  const authenticated = resetRequests.find((entry) => entry.options.headers.Authorization);
  assert.equal(authenticated.options.headers["ChatGPT-Account-Id"], "account-current");
});
