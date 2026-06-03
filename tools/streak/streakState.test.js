// streakState.test.js - covers extension-open daily streak state transitions.

const {
  getEditableDailyStreakState,
  getLocalDayKey,
  getNextDailyStreakState,
  sanitizeEditableStreakCount,
} = require("./streakState.js");

function localTime(year, monthIndex, day, hour = 12) {
  return new Date(year, monthIndex, day, hour, 0, 0, 0).getTime();
}

describe("extension daily streak state", () => {
  test("first use starts streak at 1", () => {
    const now = localTime(2026, 5, 3);
    const state = getNextDailyStreakState(null, now);

    expect(state).toEqual({
      count: 1,
      lastUseDayKey: "2026-06-03",
      updatedAt: now,
    });
  });

  test("opening again the same day does not increment", () => {
    const morning = localTime(2026, 5, 3, 9);
    const evening = localTime(2026, 5, 3, 21);
    const state = getNextDailyStreakState(
      {
        count: 4,
        lastUseDayKey: "2026-06-03",
        updatedAt: morning,
      },
      evening
    );

    expect(state.count).toBe(4);
    expect(state.lastUseDayKey).toBe("2026-06-03");
    expect(state.updatedAt).toBe(evening);
  });

  test("opening the next day increments", () => {
    const now = localTime(2026, 5, 4);
    const state = getNextDailyStreakState(
      {
        count: 4,
        lastUseDayKey: "2026-06-03",
        updatedAt: localTime(2026, 5, 3),
      },
      now
    );

    expect(state.count).toBe(5);
    expect(state.lastUseDayKey).toBe("2026-06-04");
  });

  test("missing a day resets to 1", () => {
    const now = localTime(2026, 5, 6);
    const state = getNextDailyStreakState(
      {
        count: 4,
        lastUseDayKey: "2026-06-03",
        updatedAt: localTime(2026, 5, 3),
      },
      now
    );

    expect(state.count).toBe(1);
    expect(state.lastUseDayKey).toBe("2026-06-06");
  });

  test("editable streak accepts valid whole numbers", () => {
    expect(sanitizeEditableStreakCount("0")).toBe(0);
    expect(sanitizeEditableStreakCount("5")).toBe(5);
    expect(sanitizeEditableStreakCount("007")).toBe(7);
    expect(sanitizeEditableStreakCount(12)).toBe(12);
  });

  test("editable streak rejects negative, decimal, empty, and non-number input", () => {
    expect(sanitizeEditableStreakCount("-1")).toBeNull();
    expect(sanitizeEditableStreakCount("1.5")).toBeNull();
    expect(sanitizeEditableStreakCount("")).toBeNull();
    expect(sanitizeEditableStreakCount("   ")).toBeNull();
    expect(sanitizeEditableStreakCount("abc")).toBeNull();
    expect(sanitizeEditableStreakCount(null)).toBeNull();
  });

  test("editable streak state stores the selected count for today", () => {
    const now = localTime(2026, 5, 3);

    expect(getEditableDailyStreakState("5", now)).toEqual({
      count: 5,
      lastUseDayKey: "2026-06-03",
      updatedAt: now,
    });
  });

  test("local day key formats normal local dates", () => {
    expect(getLocalDayKey(localTime(2026, 0, 5))).toBe("2026-01-05");
    expect(getLocalDayKey(localTime(2026, 11, 31, 23))).toBe("2026-12-31");
  });
});
