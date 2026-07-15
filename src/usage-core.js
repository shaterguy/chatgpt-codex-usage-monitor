(function attachCodexUsageCore(globalScope) {
  "use strict";

  const PLAN_LABELS = Object.freeze({
    free: "Free",
    go: "Go",
    plus: "Plus",
    pro: "Pro",
    prolite: "Pro",
    business: "Business",
    team: "Business",
    enterprise: "Enterprise",
    enterprise_cbp: "Enterprise",
    enterprise_cbp_usage_based: "Enterprise",
    edu: "Edu"
  });

  function isObject(value) {
    return value !== null && typeof value === "object" && !Array.isArray(value);
  }

  function firstDefined(object, keys) {
    if (!isObject(object)) return undefined;
    for (const key of keys) {
      if (object[key] !== undefined && object[key] !== null) return object[key];
    }
    return undefined;
  }

  function numberOrNull(value) {
    if (value === "" || value === null || value === undefined) return null;
    const parsed = Number(value);
    return Number.isFinite(parsed) ? parsed : null;
  }

  function booleanOrNull(value) {
    return typeof value === "boolean" ? value : null;
  }

  function clamp(value, minimum, maximum) {
    return Math.min(maximum, Math.max(minimum, value));
  }

  function epochToMilliseconds(value) {
    const numeric = numberOrNull(value);
    if (numeric === null || numeric <= 0) return null;
    return numeric < 100_000_000_000 ? numeric * 1000 : numeric;
  }

  function durationToSeconds(raw) {
    const direct = numberOrNull(
      firstDefined(raw, ["limit_window_seconds", "limitWindowSeconds", "window_seconds", "windowSeconds"])
    );
    if (direct !== null) return direct;

    const minutes = numberOrNull(firstDefined(raw, ["window_minutes", "windowMinutes"]));
    return minutes === null ? null : minutes * 60;
  }

  function normalizeWindow(raw, fallbackName) {
    if (!isObject(raw)) return null;

    const used = numberOrNull(firstDefined(raw, ["used_percent", "usedPercent", "usage_percent", "usagePercent"]));
    const remainingFromApi = numberOrNull(
      firstDefined(raw, ["remaining_percent", "remainingPercent", "remaining"])
    );
    if (used === null && remainingFromApi === null) return null;

    const usedPercent = clamp(used === null ? 100 - remainingFromApi : used, 0, 100);
    const remainingPercent = clamp(
      remainingFromApi === null ? 100 - usedPercent : remainingFromApi,
      0,
      100
    );
    const windowSeconds = durationToSeconds(raw);
    let resetAt = epochToMilliseconds(firstDefined(raw, ["reset_at", "resetAt", "resets_at", "resetsAt"]));

    if (resetAt === null) {
      const resetAfter = numberOrNull(firstDefined(raw, ["reset_after_seconds", "resetAfterSeconds"]));
      if (resetAfter !== null && resetAfter >= 0) resetAt = Date.now() + resetAfter * 1000;
    }

    return {
      name: windowName(windowSeconds, fallbackName),
      usedPercent,
      remainingPercent,
      windowSeconds,
      resetAt
    };
  }

  function windowName(windowSeconds, fallbackName) {
    if (windowSeconds !== null && windowSeconds !== undefined) {
      if (windowSeconds >= 4.5 * 3600 && windowSeconds <= 5.5 * 3600) return "5시간 한도";
      if (windowSeconds >= 6 * 24 * 3600 && windowSeconds <= 8 * 24 * 3600) return "주간 한도";
      if (windowSeconds < 24 * 3600) {
        const hours = windowSeconds / 3600;
        const text = Number.isInteger(hours) ? String(hours) : hours.toFixed(1);
        return `${text}시간 한도`;
      }
      const days = windowSeconds / (24 * 3600);
      const text = Number.isInteger(days) ? String(days) : days.toFixed(1);
      return `${text}일 한도`;
    }
    return fallbackName;
  }

  function unwrapPayload(raw) {
    if (!isObject(raw)) return {};
    if (isObject(raw.data) && !raw.rate_limit && !raw.rateLimit && !raw.rate_limits && !raw.rateLimits) {
      return raw.data;
    }
    return raw;
  }

  function selectMainLimit(payload) {
    const direct = firstDefined(payload, ["rate_limit", "rateLimit"]);
    if (isObject(direct)) return direct;

    const snapshots = firstDefined(payload, ["rate_limits", "rateLimits"]);
    if (Array.isArray(snapshots)) {
      return snapshots.find((entry) => {
        const id = firstDefined(entry, ["limit_id", "limitId", "metered_feature", "meteredFeature"]);
        return id === "codex";
      }) || snapshots[0] || {};
    }
    if (isObject(snapshots)) return snapshots;
    return payload;
  }

  function windowFromLimit(limit, role) {
    const keys = role === "primary"
      ? ["primary_window", "primaryWindow", "primary"]
      : ["secondary_window", "secondaryWindow", "secondary"];
    return firstDefined(limit, keys);
  }

  function normalizeAdditionalLimits(payload) {
    const entries = firstDefined(payload, ["additional_rate_limits", "additionalRateLimits"]);
    if (!Array.isArray(entries)) return [];

    return entries.map((entry, index) => {
      const limit = firstDefined(entry, ["rate_limit", "rateLimit"]) || entry;
      const label = firstDefined(entry, ["limit_name", "limitName", "metered_feature", "meteredFeature"]);
      return {
        id: String(firstDefined(entry, ["metered_feature", "meteredFeature", "limit_name", "limitName"]) || index),
        label: humanizeLabel(label) || `추가 한도 ${index + 1}`,
        primary: normalizeWindow(windowFromLimit(limit, "primary"), humanizeLabel(label) || "추가 한도"),
        secondary: normalizeWindow(windowFromLimit(limit, "secondary"), `${humanizeLabel(label) || "추가"} 장기 한도`)
      };
    }).filter((entry) => entry.primary || entry.secondary);
  }

  function normalizeCredits(payload) {
    const credits = firstDefined(payload, ["credits", "credit_status", "creditStatus"]);
    const resetCredits = firstDefined(payload, ["rate_limit_reset_credits", "rateLimitResetCredits"]);
    const balance = isObject(credits) ? firstDefined(credits, ["balance", "remaining_balance", "remainingBalance"]) : null;
    const numericBalance = numberOrNull(balance);

    return {
      hasCredits: isObject(credits) ? booleanOrNull(firstDefined(credits, ["has_credits", "hasCredits"])) : null,
      unlimited: isObject(credits) ? booleanOrNull(firstDefined(credits, ["unlimited", "is_unlimited", "isUnlimited"])) : null,
      balance: numericBalance === null && balance !== null && balance !== undefined ? String(balance) : numericBalance,
      resetCreditsAvailable: isObject(resetCredits)
        ? numberOrNull(firstDefined(resetCredits, ["available_count", "availableCount"]))
        : null
    };
  }

  function normalizeSpendControl(payload) {
    const spend = firstDefined(payload, ["spend_control", "spendControl"]);
    if (!isObject(spend)) return null;
    const limit = firstDefined(spend, ["individual_limit", "individualLimit"]);
    if (!isObject(limit)) {
      return { reached: booleanOrNull(firstDefined(spend, ["reached", "limit_reached", "limitReached"])) };
    }

    return {
      reached: booleanOrNull(firstDefined(spend, ["reached", "limit_reached", "limitReached"])),
      usedPercent: numberOrNull(firstDefined(limit, ["used_percent", "usedPercent"])),
      remainingPercent: numberOrNull(firstDefined(limit, ["remaining_percent", "remainingPercent"])),
      limit: firstDefined(limit, ["limit", "total"]),
      used: firstDefined(limit, ["used"]),
      resetAt: epochToMilliseconds(firstDefined(limit, ["reset_at", "resetAt"]))
    };
  }

  function normalizeUsage(raw) {
    const payload = unwrapPayload(raw);
    const mainLimit = selectMainLimit(payload);
    const primary = normalizeWindow(windowFromLimit(mainLimit, "primary"), "단기 한도");
    const secondary = normalizeWindow(windowFromLimit(mainLimit, "secondary"), "주간 한도");
    const planType = String(
      firstDefined(payload, ["plan_type", "planType"]) || firstDefined(mainLimit, ["plan_type", "planType"]) || ""
    ).toLowerCase();
    const allowed = booleanOrNull(firstDefined(mainLimit, ["allowed", "is_allowed", "isAllowed"]));
    const limitReached = booleanOrNull(firstDefined(mainLimit, ["limit_reached", "limitReached"]));
    const normalized = {
      planType,
      planLabel: PLAN_LABELS[planType] || humanizeLabel(planType) || "계정",
      allowed,
      limitReached,
      primary,
      secondary,
      additional: normalizeAdditionalLimits(payload),
      credits: normalizeCredits(payload),
      spendControl: normalizeSpendControl(payload)
    };

    normalized.hasUsageData = Boolean(
      normalized.primary || normalized.secondary || normalized.additional.length ||
      normalized.credits.balance !== null || normalized.credits.unlimited === true
    );
    return normalized;
  }

  function humanizeLabel(value) {
    if (value === null || value === undefined) return "";
    return String(value)
      .replace(/^codex[_-]?/i, "")
      .replace(/[_-]+/g, " ")
      .trim()
      .replace(/\b\w/g, (letter) => letter.toUpperCase());
  }

  function formatResetTime(timestamp, now) {
    if (!timestamp) return "리셋 시간 미제공";
    const date = new Date(timestamp);
    if (Number.isNaN(date.getTime())) return "리셋 시간 미제공";
    const current = now ? new Date(now) : new Date();
    const sameDay = date.getFullYear() === current.getFullYear() &&
      date.getMonth() === current.getMonth() && date.getDate() === current.getDate();
    const tomorrow = new Date(current.getFullYear(), current.getMonth(), current.getDate() + 1);
    const isTomorrow = date.getFullYear() === tomorrow.getFullYear() &&
      date.getMonth() === tomorrow.getMonth() && date.getDate() === tomorrow.getDate();
    const time = new Intl.DateTimeFormat("ko-KR", {
      hour: "2-digit",
      minute: "2-digit",
      hour12: false
    }).format(date);
    if (sameDay) return `오늘 ${time} 리셋`;
    if (isTomorrow) return `내일 ${time} 리셋`;
    const full = new Intl.DateTimeFormat("ko-KR", {
      month: "numeric",
      day: "numeric",
      hour: "2-digit",
      minute: "2-digit",
      hour12: false
    }).format(date);
    return `${full} 리셋`;
  }

  const api = Object.freeze({
    clamp,
    formatResetTime,
    normalizeUsage,
    normalizeWindow,
    windowName
  });

  globalScope.CodexUsageCore = api;
  if (typeof module !== "undefined" && module.exports) module.exports = api;
})(typeof globalThis !== "undefined" ? globalThis : this);
