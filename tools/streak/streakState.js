// streakState.js - pure local-day streak helpers for extension-open tracking.

(() => {
  const EXTENSION_STREAK_STORAGE_KEY = "extensionStreak";
  const DAY_KEY_PATTERN = /^(\d{4})-(\d{2})-(\d{2})$/;
  const MILLISECONDS_PER_DAY = 24 * 60 * 60 * 1000;

  function getLocalDayKey(timestamp = Date.now()) {
    const date = new Date(timestamp);
    const year = date.getFullYear();
    const month = String(date.getMonth() + 1).padStart(2, "0");
    const day = String(date.getDate()).padStart(2, "0");

    return `${year}-${month}-${day}`;
  }

  function getNextDailyStreakState(previousState, now = Date.now()) {
    const todayKey = getLocalDayKey(now);
    const todayNumber = getDayNumber(todayKey);
    const previousDayNumber = getDayNumber(previousState?.lastUseDayKey);
    const previousCount = sanitizeStoredStreakCount(previousState?.count);

    if (previousDayNumber === null || previousCount === null) {
      return createExtensionStreakState(1, now);
    }

    if (previousDayNumber === todayNumber) {
      return createExtensionStreakState(previousCount, now);
    }

    if (previousDayNumber === todayNumber - 1) {
      return createExtensionStreakState(previousCount + 1, now);
    }

    return createExtensionStreakState(1, now);
  }

  function getEditableDailyStreakState(value, now = Date.now()) {
    const count = sanitizeEditableStreakCount(value);

    if (count === null) {
      return null;
    }

    return createExtensionStreakState(count, now);
  }

  function sanitizeEditableStreakCount(value) {
    if (typeof value === "string") {
      const trimmed = value.trim();

      if (!/^\d+$/.test(trimmed)) {
        return null;
      }

      const parsed = Number(trimmed);
      return Number.isSafeInteger(parsed) ? parsed : null;
    }

    if (Number.isSafeInteger(value) && value >= 0) {
      return value;
    }

    return null;
  }

  function createExtensionStreakState(count, now = Date.now()) {
    return {
      count,
      lastUseDayKey: getLocalDayKey(now),
      updatedAt: now,
    };
  }

  function sanitizeStoredStreakCount(value) {
    return Number.isSafeInteger(value) && value >= 0 ? value : null;
  }

  function getDayNumber(dayKey) {
    if (typeof dayKey !== "string") {
      return null;
    }

    const match = dayKey.match(DAY_KEY_PATTERN);

    if (!match) {
      return null;
    }

    const year = Number(match[1]);
    const monthIndex = Number(match[2]) - 1;
    const day = Number(match[3]);

    return Date.UTC(year, monthIndex, day) / MILLISECONDS_PER_DAY;
  }

  const FocusKitStreakState = {
    EXTENSION_STREAK_STORAGE_KEY,
    getEditableDailyStreakState,
    getLocalDayKey,
    getNextDailyStreakState,
    sanitizeEditableStreakCount,
  };

  if (typeof globalThis !== "undefined") {
    globalThis.FocusKitStreakState = FocusKitStreakState;
  }

  if (typeof module !== "undefined") {
    module.exports = FocusKitStreakState;
  }
})();
