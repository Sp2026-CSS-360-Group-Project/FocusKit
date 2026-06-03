// pomodoroState.js - shared Pomodoro timer state helpers for popup and background.

(() => {
  // Keep the timer duration and storage key centralized across extension contexts.
  const POMODORO_DEFAULT_DURATION_SECONDS = 25 * 60;
  const POMODORO_MAX_DURATION_SECONDS = 180 * 60;
  const POMODORO_SHORT_BREAK_SECONDS = 5 * 60;
  const POMODORO_LONG_BREAK_SECONDS = 15 * 60;
  const POMODORO_DURATION_SECONDS = POMODORO_DEFAULT_DURATION_SECONDS;
  const POMODORO_STORAGE_KEY = "pomodoroState";

  // Build a fresh paused Pomodoro state using an injectable timestamp for tests.
  function createInitialPomodoroState(
    now = Date.now(),
    durationSeconds = POMODORO_DEFAULT_DURATION_SECONDS
  ) {
    const safeDuration =
      normalizePomodoroDurationSeconds(durationSeconds) ||
      POMODORO_DEFAULT_DURATION_SECONDS;

    return {
      remainingSeconds: safeDuration,
      durationSeconds: safeDuration,
      isRunning: false,
      lastUpdatedAt: now,
      completionFired: false,
    };
  }

  // Build a fresh paused break state using the given duration in seconds.
  function createBreakState(breakDurationSeconds = POMODORO_SHORT_BREAK_SECONDS, now = Date.now()) {
    const safeDuration = normalizePomodoroDurationSeconds(breakDurationSeconds) || POMODORO_SHORT_BREAK_SECONDS;
    return {
      remainingSeconds: safeDuration,
      durationSeconds: safeDuration,
      isRunning: false,
      isBreak: true,
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
      durationSeconds:
        normalizePomodoroDurationSeconds(resolveSavedDurationSeconds(state)) ||
        POMODORO_DEFAULT_DURATION_SECONDS,
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
        normalizePomodoroDurationSeconds(
          resolveSavedDurationSeconds(sourceOrNow)
        )
      );
    }

    return createInitialPomodoroState(sourceOrNow);
  }

  // Change the selected duration only while the timer is paused.
  function setPomodoroDurationSeconds(state, seconds, now = Date.now()) {
    const durationSeconds = normalizePomodoroDurationSeconds(seconds);

    if (!durationSeconds || state.isRunning) {
      return state;
    }

    return {
      remainingSeconds: durationSeconds,
      durationSeconds,
      isRunning: false,
      lastUpdatedAt: now,
      completionFired: false,
    };
  }

  // Normalize stored state so stale or malformed values cannot break the extension.
  function restorePomodoroState(savedState, now = Date.now(), options = {}) {
    if (!savedState || typeof savedState.remainingSeconds !== "number") {
      return createInitialPomodoroState(now);
    }

    const durationSeconds =
      normalizePomodoroDurationSeconds(
        resolveSavedDurationSeconds(savedState)
      ) || POMODORO_DEFAULT_DURATION_SECONDS;

    if (
      !options.preserveCompleted &&
      (savedState.remainingSeconds <= 0 || savedState.completionFired)
    ) {
      return createInitialPomodoroState(now);
    }

    return tickPomodoro(
      {
        remainingSeconds: Math.min(
          durationSeconds,
          Math.max(0, savedState.remainingSeconds)
        ),
        durationSeconds,
        isRunning: Boolean(savedState.isRunning),
        isBreak: Boolean(savedState.isBreak),
        lastUpdatedAt:
          typeof savedState.lastUpdatedAt === "number"
            ? savedState.lastUpdatedAt
            : now,
        completionFired: Boolean(savedState.completionFired),
      },
      now
    );
  }

  // Parse editable mm:ss input and reject unsafe timer values.
  function parsePomodoroTimeInput(value) {
    if (typeof value !== "string" || !value.trim()) {
      return null;
    }

    const match = value.trim().match(/^(\d+):(\d{1,2})$/);

    if (!match) {
      return null;
    }

    const minutes = Number(match[1]);
    const seconds = Number(match[2]);

    if (seconds >= 60) {
      return null;
    }

    return normalizePomodoroDurationSeconds(minutes * 60 + seconds);
  }

  // Keep editable input display normalized to the same shape as the timer.
  function formatPomodoroInput(totalSeconds) {
    return formatTime(totalSeconds);
  }

  // Accept selected durations in seconds and reject unsafe values.
  function normalizePomodoroDurationSeconds(value) {
    if (value === "" || value === null || value === undefined) {
      return null;
    }

    const durationSeconds = Number(value);

    if (
      !Number.isInteger(durationSeconds) ||
      durationSeconds < 1 ||
      durationSeconds > POMODORO_MAX_DURATION_SECONDS
    ) {
      return null;
    }

    return durationSeconds;
  }

  // Read new seconds-based duration, with migration support for old minute state.
  function resolveSavedDurationSeconds(state) {
    if (!state) {
      return null;
    }

    if (typeof state.durationSeconds === "number") {
      return state.durationSeconds;
    }

    if (typeof state.durationMinutes === "number") {
      return state.durationMinutes * 60;
    }

    return null;
  }

  // Share helpers with browser scripts loaded directly by popup.html and importScripts().
  const FocusKitPomodoroState = {
    POMODORO_DEFAULT_DURATION_SECONDS,
    POMODORO_DURATION_SECONDS,
    POMODORO_MAX_DURATION_SECONDS,
    POMODORO_SHORT_BREAK_SECONDS,
    POMODORO_LONG_BREAK_SECONDS,
    POMODORO_STORAGE_KEY,
    createBreakState,
    createInitialPomodoroState,
    formatPomodoroInput,
    formatTime,
    normalizePomodoroDurationSeconds,
    parsePomodoroTimeInput,
    pausePomodoro,
    resetPomodoro,
    restorePomodoroState,
    setPomodoroDurationSeconds,
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
