"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const core = require("../src/usage-core.js");

test("normalizes the current snake_case Codex usage response", () => {
  const result = core.normalizeUsage({
    plan_type: "plus",
    rate_limit: {
      allowed: true,
      limit_reached: false,
      primary_window: {
        used_percent: 37,
        limit_window_seconds: 18_000,
        reset_at: 1_800_000_000
      },
      secondary_window: {
        used_percent: 8,
        limit_window_seconds: 604_800,
        reset_at: 1_800_604_800
      }
    },
    credits: {
      has_credits: true,
      unlimited: false,
      balance: "12.50"
    },
    rate_limit_reset_credits: { available_count: 2 }
  });

  assert.equal(result.planLabel, "Plus");
  assert.equal(result.primary.name, "5시간 한도");
  assert.equal(result.primary.usedPercent, 37);
  assert.equal(result.primary.remainingPercent, 63);
  assert.equal(result.secondary.name, "주간 한도");
  assert.equal(result.secondary.remainingPercent, 92);
  assert.equal(result.primary.resetAt, 1_800_000_000_000);
  assert.equal(result.credits.balance, 12.5);
  assert.equal(result.credits.resetCreditsAvailable, 2);
  assert.equal(result.hasUsageData, true);
});

test("supports camelCase and app-server snapshot variants", () => {
  const result = core.normalizeUsage({
    planType: "prolite",
    rateLimits: {
      primary: {
        usedPercent: 91,
        windowMinutes: 300,
        resetsAt: 1_800_000_001
      },
      secondary: {
        remainingPercent: 44,
        windowMinutes: 10_080,
        resetsAt: 1_800_000_002
      }
    }
  });

  assert.equal(result.planLabel, "Pro");
  assert.equal(result.primary.remainingPercent, 9);
  assert.equal(result.secondary.usedPercent, 56);
  assert.equal(result.secondary.name, "주간 한도");
});

test("keeps additional rate limits and spend controls", () => {
  const result = core.normalizeUsage({
    plan_type: "business",
    rate_limit: {
      primary_window: { used_percent: 20, limit_window_seconds: 18_000 }
    },
    additional_rate_limits: [
      {
        limit_name: "codex_other",
        metered_feature: "codex_other",
        rate_limit: {
          primary_window: { used_percent: 70, limit_window_seconds: 1_800 }
        }
      }
    ],
    spend_control: {
      reached: false,
      individual_limit: {
        used_percent: 32,
        remaining_percent: 68,
        reset_at: 1_800_000_003
      }
    }
  });

  assert.equal(result.additional.length, 1);
  assert.equal(result.additional[0].label, "Other");
  assert.equal(result.additional[0].primary.remainingPercent, 30);
  assert.equal(result.spendControl.remainingPercent, 68);
});

test("clamps malformed percentages instead of breaking the widget", () => {
  const over = core.normalizeWindow({ used_percent: 140 }, "단기 한도");
  const under = core.normalizeWindow({ used_percent: -20 }, "단기 한도");
  assert.deepEqual([over.usedPercent, over.remainingPercent], [100, 0]);
  assert.deepEqual([under.usedPercent, under.remainingPercent], [0, 100]);
});

test("marks responses without limits or credits as unavailable", () => {
  const result = core.normalizeUsage({ plan_type: "plus", rate_limit: { allowed: true } });
  assert.equal(result.primary, null);
  assert.equal(result.secondary, null);
  assert.equal(result.hasUsageData, false);
});

test("uses a stable reset-window key that does not depend on credit count", () => {
  const base = {
    primary: { remainingPercent: 4, resetAt: 1_800_000_000_123, windowSeconds: 18_000 },
    credits: { resetCreditsAvailable: 1 }
  };
  const changedCredits = {
    ...base,
    credits: { resetCreditsAvailable: 3 }
  };
  assert.equal(core.resetWindowKey(base), core.resetWindowKey(changedCredits));
  assert.equal(core.resetWindowKey(base), "reset:30000000");
});

test("snoozes the low-usage reset prompt for 30 minutes without permanent suppression", () => {
  const usage = {
    primary: { remainingPercent: 4, resetAt: 1_800_000_000_000, windowSeconds: 18_000 },
    credits: { resetCreditsAvailable: 1 }
  };
  const windowKey = core.resetWindowKey(usage);
  const settings = {
    resetPromptSnoozedWindowKey: windowKey,
    resetPromptSnoozeUntil: 2_000_000
  };
  assert.equal(core.evaluateResetPrompt(usage, settings, 1_999_999).reason, "snoozed");
  assert.equal(core.evaluateResetPrompt(usage, settings, 2_000_001).shouldOffer, true);
});

test("suppresses automatic prompts until the displayed remaining usage reaches zero", () => {
  const usage = {
    primary: { remainingPercent: 4, resetAt: 1_800_000_000_000, windowSeconds: 18_000 },
    credits: { resetCreditsAvailable: 1 }
  };
  const settings = {
    resetPromptSuppressUntilZeroWindowKey: core.resetWindowKey(usage)
  };
  assert.equal(core.evaluateResetPrompt(usage, settings, 1).reason, "suppressed-until-zero");
  usage.primary.remainingPercent = 0.4;
  const zeroDecision = core.evaluateResetPrompt(usage, settings, 1);
  assert.equal(zeroDecision.shouldOffer, true);
  assert.equal(zeroDecision.reason, "zero-reached");
});

test("does not offer a reset prompt without an available reset credit", () => {
  const usage = {
    primary: { remainingPercent: 0, resetAt: 1_800_000_000_000, windowSeconds: 18_000 },
    credits: { resetCreditsAvailable: 0 }
  };
  assert.equal(core.evaluateResetPrompt(usage, {}, 1).reason, "ineligible");
});
