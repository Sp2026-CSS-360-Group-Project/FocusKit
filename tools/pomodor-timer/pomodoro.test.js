// pomodoro.test.js - covers pure Pomodoro timer state transitions and formatting.

const {
  POMODORO_DURATION_SECONDS,
  createInitialPomodoroState,
  formatTime,
  pausePomodoro,
  resetPomodoro,
  restorePomodoroState,
  startPomodoro,
  tickPomodoro,
} = require("./pomodoroState.js");

describe("Pomodoro timer state", () => {
  test("initial state is 25:00 and paused", () => {
    const state = createInitialPomodoroState(1000);

    expect(state.remainingSeconds).toBe(POMODORO_DURATION_SECONDS);
    expect(state.isRunning).toBe(false);
    expect(formatTime(state.remainingSeconds)).toBe("25:00");
  });

  test("start changes state to running", () => {
    const state = startPomodoro(createInitialPomodoroState(1000), 2000);

    expect(state.isRunning).toBe(true);
    expect(state.remainingSeconds).toBe(POMODORO_DURATION_SECONDS);
    expect(state.lastUpdatedAt).toBe(2000);
  });

  test("pause changes state to paused without resetting time", () => {
    const running = startPomodoro(createInitialPomodoroState(1000), 1000);
    const paused = pausePomodoro(running, 61000);

    expect(paused.isRunning).toBe(false);
    expect(paused.remainingSeconds).toBe(POMODORO_DURATION_SECONDS - 60);
  });

  test("reset restores 25:00 and paused state", () => {
    const state = resetPomodoro(3000);

    expect(state.remainingSeconds).toBe(POMODORO_DURATION_SECONDS);
    expect(state.isRunning).toBe(false);
    expect(state.lastUpdatedAt).toBe(3000);
  });

  test("timer formatting displays mm:ss", () => {
    expect(formatTime(1500)).toBe("25:00");
    expect(formatTime(65)).toBe("01:05");
    expect(formatTime(0)).toBe("00:00");
  });

  test("saved Pomodoro state restores correctly", () => {
    const saved = {
      remainingSeconds: 1200,
      isRunning: false,
      lastUpdatedAt: 5000,
    };

    expect(restorePomodoroState(saved, 10000)).toEqual(saved);
  });

  test("countdown logic reduces remaining time", () => {
    const running = startPomodoro(createInitialPomodoroState(1000), 1000);
    const afterFiveSeconds = tickPomodoro(running, 6000);

    expect(afterFiveSeconds.remainingSeconds).toBe(
      POMODORO_DURATION_SECONDS - 5
    );
    expect(afterFiveSeconds.isRunning).toBe(true);
  });

  test("timer never goes below 00:00", () => {
    const running = {
      remainingSeconds: 2,
      isRunning: true,
      lastUpdatedAt: 1000,
    };
    const elapsed = tickPomodoro(running, 10000);

    expect(elapsed.remainingSeconds).toBe(0);
    expect(formatTime(elapsed.remainingSeconds)).toBe("00:00");
    expect(elapsed.isRunning).toBe(false);
  });
});
