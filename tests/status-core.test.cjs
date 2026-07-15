"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const core = require("../src/status-core.js");

function component(name, status, updatedAt) {
  return { name, status, updated_at: updatedAt || "2026-07-15T00:00:00Z" };
}

test("includes only ChatGPT web components and ignores unrelated API outages", () => {
  const result = core.normalizeStatus({
    components: [
      component("Login", "operational"),
      component("Conversations", "operational"),
      component("ChatGPT Work", "operational"),
      component("Files", "operational"),
      component("Search", "operational"),
      component("Connectors/Apps", "operational"),
      component("GPTs", "operational"),
      component("Image Generation", "operational"),
      component("Agent", "operational"),
      component("Sites", "operational"),
      component("Codex Web", "operational"),
      component("Codex API", "major_outage"),
      component("Batch", "partial_outage"),
      component("VS Code extension", "degraded_performance")
    ]
  });

  assert.equal(result.available, true);
  assert.equal(result.overall, "operational");
  assert.equal(result.overallLabel, "모두 정상");
  assert.deepEqual(
    result.components.map((entry) => entry.name),
    ["Login", "Conversations", "ChatGPT Work", "Files", "Search", "Connectors/Apps", "GPTs", "Image Generation", "Agent", "Sites", "Codex Web"]
  );
});

test("accepts the former File uploads component name", () => {
  const result = core.normalizeStatus({ components: [component("File uploads", "operational")] });
  assert.equal(result.components.length, 1);
  assert.equal(result.components[0].name, "Files");
  assert.equal(result.components[0].label, "파일");
});

test("uses the worst relevant ChatGPT web component for the summary", () => {
  const result = core.normalizeStatus({
    components: [
      component("Login", "operational"),
      component("Conversations", "partial_outage"),
      component("ChatGPT Work", "degraded_performance")
    ]
  });

  assert.equal(result.overall, "partial_outage");
  assert.equal(result.overallLabel, "일부 장애");
  assert.equal(result.tone, "danger");
});

test("deduplicates repeated component names using the worst state", () => {
  const result = core.normalizeStatus({
    components: [
      component("Login", "operational", "2026-07-15T00:00:00Z"),
      component("Login", "degraded_performance", "2026-07-15T00:01:00Z")
    ]
  });

  assert.equal(result.components.length, 1);
  assert.equal(result.components[0].status, "degraded_performance");
  assert.equal(result.components[0].statusLabel, "성능 저하");
  assert.equal(result.components[0].updatedAt, Date.parse("2026-07-15T00:01:00Z"));
});
