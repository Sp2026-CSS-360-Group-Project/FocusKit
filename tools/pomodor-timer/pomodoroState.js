// pomodoroState.js - shared Pomodoro timer state helpers for popup and background.

(() => {
  // Keep the timer duration and storage key centralized across extension contexts.
  const POMODORO_DEFAULT_DURATION_MINUTES = 25;
  const POMODORO_MAX_DURATION_MINUTES = 180;
  const POMODORO_DURATION_SECONDS = POMODORO_DEFAULT_DURATION_MINUTES * 60;
  const POMODORO_STORAGE_KEY = "pomodoroState";

  // Build a fresh paused Pomodoro state using an injectable timestamp for tests.
  function createInitialPomodoroState(
    now = Date.now(),
    durationMinutes = POMODORO_DEFAULT_DURATION_MINUTES
  ) {
    const safeDuration =
      normalizePomodoroDurationMinutes(durationMinutes) ||
      POMODORO_DEFAULT_DURATION_MINUTES;

    return {
      remainingSeconds: safeDuration * 60,
      durationMinutes: safeDuration,
      isRunning: false,
      lastUpdatedAt: now,
      completionFired: false,
    };
  }

  // Format the timer display and clamp negative values to zero.
  function formatTime(totalSeconds) {
    const safeSeconds = Math.max(0, Math.floor(totalSeconds));
    const minutes = Math.floor(safeSeconds / 60)
      .toString()
      .padStart(2, "0");
    const seconds = (safeSeconds % 60).toString().padStart(2, "0");

    return `${minutes}:${seconds}`;
  }

  // Advance a running timer according to elapsed wall-clock time.
  function tickPomodoro(state, now = Date.now()) {
    if (!state.isRunning) {
      return { ...state };
    }

    const elapsedSeconds = Math.max(
      0,
      Math.floor((now - state.lastUpdatedAt) / 1000)
    );
    const remainingSeconds = Math.max(
      0,
      state.remainingSeconds - elapsedSeconds
    );

    return {
      remainingSeconds,
      durationMinutes:
        normalizePomodoroDurationMinutes(state.durationMinutes) ||
        POMODORO_DEFAULT_DURATION_MINUTES,
      isRunning: remainingSeconds > 0,
      lastUpdatedAt: now,
      completionFired: Boolean(state.completionFired),
    };
  }

  // Mark the timer running after first accounting for any elapsed saved time.
  function startPomodoro(state, now = Date.now()) {
    const currentState = tickPomodoro(state, now);

    return {
      ...currentState,
      isRunning: currentState.remainingSeconds > 0,
      lastUpdatedAt: now,
      completionFired: false,
    };
  }

  // Pause the timer without discarding elapsed time.
  function pausePomodoro(state, now = Date.now()) {
    const currentState = tickPomodoro(state, now);

    return {
      ...currentState,
      isRunning: false,
      lastUpdatedAt: now,
    };
  }

  // Return a clean timer using the selected duration, or 25 minutes by default.
  function resetPomodoro(sourceOrNow = Date.now(), now = Date.now()) {
    if (typeof sourceOrNow === "object" && sourceOrNow) {
      return createInitialPomodoroState(
        now,
        normalizePomodoroDurationMinutes(sourceOrNow.durationMinutes)
      );
    }

    return createInitialPomodoroState(sourceOrNow);
  }

  // Change the selected duration only while the timer is paused.
  function setPomodoroDuration(state, minutes, now = Date.now()) {
    const durationMinutes = normalizePomodoroDurationMinutes(minutes);

    if (!durationMinutes || state.isRunning) {
      return state;
    }

    return {
      remainingSeconds: durationMinutes * 60,
      durationMinutes,
      isRunning: false,
      lastUpdatedAt: now,
      completionFired: false,
    };
  }

  // Normalize stored state so stale or malformed values cannot break the extension.
  function restorePomodoroState(savedState, now = Date.now()) {
    if (!savedState || typeof savedState.remainingSeconds !== "number") {
      return createInitialPomodoroState(now);
    }

    const durationMinutes =
      normalizePomodoroDurationMinutes(savedState.durationMinutes) ||
      POMODORO_DEFAULT_DURATION_MINUTES;

    return tickPomodoro(
      {
        remainingSeconds: Math.min(
          durationMinutes * 60,
          Math.max(0, savedState.remainingSeconds)
        ),
        durationMinutes,
        isRunning: Boolean(savedState.isRunning),
        lastUpdatedAt:
          typeof savedState.lastUpdatedAt === "number"
            ? savedState.lastUpdatedAt
            : now,
        completionFired: Boolean(savedState.completionFired),
      },
      now
    );
  }

  // Accept whole-minute values from popup inputs and reject unsafe durations.
  function normalizePomodoroDurationMinutes(value) {
    if (value === "" || value === null || value === undefined) {
      return null;
    }

    const durationMinutes = Number(value);

    if (
      !Number.isInteger(durationMinutes) ||
      durationMinutes < 1 ||
      durationMinutes > POMODORO_MAX_DURATION_MINUTES
    ) {
      return null;
    }

    return durationMinutes;
  }

  // Share helpers with browser scripts loaded directly by popup.html and importScripts().
  const FocusKitPomodoroState = {
    POMODORO_DEFAULT_DURATION_MINUTES,
    POMODORO_DURATION_SECONDS,
    POMODORO_MAX_DURATION_MINUTES,
    POMODORO_STORAGE_KEY,
    createInitialPomodoroState,
    formatTime,
    normalizePomodoroDurationMinutes,
    pausePomodoro,
    resetPomodoro,
    restorePomodoroState,
    setPomodoroDuration,
    startPomodoro,
    tickPomodoro,
  };

  if (typeof globalThis !== "undefined") {
    globalThis.FocusKitPomodoroState = FocusKitPomodoroState;
  }

  // Export pure timer helpers for Jest.
  if (typeof module !== "undefined") {
    module.exports = FocusKitPomodoroState;
  }
})();
