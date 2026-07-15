"use strict";

importScripts("status-core.js");

const STATUS_URL = "https://status.openai.com/api/v2/summary.json";
const CACHE_TTL_MS = 60_000;
let cachedResult = null;
let cachedAt = 0;
let inFlight = null;

async function fetchChatGptWebStatus(force) {
  const now = Date.now();
  if (!force && cachedResult && now - cachedAt < CACHE_TTL_MS) return cachedResult;
  if (inFlight) return inFlight;

  inFlight = fetch(STATUS_URL, {
    method: "GET",
    cache: "no-store",
    credentials: "omit",
    headers: { Accept: "application/json" }
  }).then(async (response) => {
    if (!response.ok) throw new Error(`OpenAI status request failed: ${response.status}`);
    const payload = await response.json();
    const status = globalThis.ChatGptStatusCore.normalizeStatus(payload);
    if (!status.available) throw new Error("No ChatGPT web components found");
    cachedResult = { ok: true, status, fetchedAt: Date.now() };
    cachedAt = Date.now();
    return cachedResult;
  }).catch(() => ({
    ok: false,
    error: "ChatGPT 웹 상태를 확인하지 못했습니다.",
    fetchedAt: Date.now()
  })).finally(() => {
    inFlight = null;
  });

  return inFlight;
}

chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
  if (!message || message.type !== "codex-usage-bar:fetch-chatgpt-status") return false;
  fetchChatGptWebStatus(Boolean(message.force)).then(sendResponse);
  return true;
});
