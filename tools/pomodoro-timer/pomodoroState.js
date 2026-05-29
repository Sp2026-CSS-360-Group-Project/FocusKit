// pomodoroState.js - shared Pomodoro timer state helpers for popup and background.

(() => {
  // Keep the timer duration and storage key centralized across extension contexts.
  const POMODORO_DURATION_SECONDS = 25 * 60;
  const POMODORO_STORAGE_KEY = "pomodoroState";

  // Build a fresh paused Pomodoro state using an injectable timestamp for tests.
  function createInitialPomodoroState(now = Date.now()) {
    return {
      remainingSeconds: POMODORO_DURATION_SECONDS,
      isRunning: false,
      lastUpdatedAt: now,
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
      isRunning: remainingSeconds > 0,
      lastUpdatedAt: now,
    };
  }

  // Mark the timer running after first accounting for any elapsed saved time.
  function startPomodoro(state, now = Date.now()) {
    const currentState = tickPomodoro(state, now);

    return {
      ...currentState,
      isRunning: currentState.remainingSeconds > 0,
      lastUpdatedAt: now,
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

  // Return a clean 25-minute timer.
  function resetPomodoro(now = Date.now()) {
    return createInitialPomodoroState(now);
  }

  // Normalize stored state so stale or malformed values cannot break the extension.
  function restorePomodoroState(savedState, now = Date.now()) {
    if (!savedState || typeof savedState.remainingSeconds !== "number") {
      return createInitialPomodoroState(now);
    }

    return tickPomodoro(
      {
        remainingSeconds: Math.min(
          POMODORO_DURATION_SECONDS,
          Math.max(0, savedState.remainingSeconds)
        ),
        isRunning: Boolean(savedState.isRunning),
        lastUpdatedAt:
          typeof savedState.lastUpdatedAt === "number"
            ? savedState.lastUpdatedAt
            : now,
      },
      now
    );
  }

  // Share helpers with browser scripts loaded directly by popup.html and importScripts().
  const FocusKitPomodoroState = {
    POMODORO_DURATION_SECONDS,
    POMODORO_STORAGE_KEY,
    createInitialPomodoroState,
    formatTime,
    pausePomodoro,
    resetPomodoro,
    restorePomodoroState,
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
