// pomodoro.test.js - covers pure Pomodoro timer state transitions and formatting.

const {
  POMODORO_DEFAULT_DURATION_SECONDS,
  POMODORO_DURATION_SECONDS,
  createInitialPomodoroState,
  formatTime,
  parsePomodoroTimeInput,
  pausePomodoro,
  resetPomodoro,
  restorePomodoroState,
  setPomodoroDurationSeconds,
  startPomodoro,
  tickPomodoro,
} = require("./pomodoroState.js");

describe("Pomodoro timer state", () => {
  test("initial state is 25:00 and paused", () => {
    const state = createInitialPomodoroState(1000);

    expect(state.remainingSeconds).toBe(POMODORO_DURATION_SECONDS);
    expect(state.durationSeconds).toBe(POMODORO_DEFAULT_DURATION_SECONDS);
    expect(state.isRunning).toBe(false);
    expect(formatTime(state.remainingSeconds)).toBe("25:00");
  });

  test("restoring missing state gives 25:00 and paused", () => {
    const state = restorePomodoroState(null, 1000);

    expect(state.remainingSeconds).toBe(POMODORO_DEFAULT_DURATION_SECONDS);
    expect(state.durationSeconds).toBe(POMODORO_DEFAULT_DURATION_SECONDS);
    expect(state.isRunning).toBe(false);
    expect(formatTime(state.remainingSeconds)).toBe("25:00");
  });

  test("parse accepts mm:ss input", () => {
    expect(parsePomodoroTimeInput("0:01")).toBe(1);
    expect(parsePomodoroTimeInput("1:30")).toBe(90);
    expect(parsePomodoroTimeInput("25:00")).toBe(1500);
  });

  test("parse rejects invalid input", () => {
    expect(parsePomodoroTimeInput("")).toBeNull();
    expect(parsePomodoroTimeInput("abc")).toBeNull();
    expect(parsePomodoroTimeInput("1:99")).toBeNull();
    expect(parsePomodoroTimeInput("0:00")).toBeNull();
    expect(parsePomodoroTimeInput("-1:00")).toBeNull();
    expect(parsePomodoroTimeInput("181:00")).toBeNull();
  });

  test("duration can be changed while paused", () => {
    const state = setPomodoroDurationSeconds(
      createInitialPomodoroState(1000),
      90,
      2000
    );

    expect(state.remainingSeconds).toBe(90);
    expect(state.durationSeconds).toBe(90);
    expect(state.isRunning).toBe(false);
    expect(state.lastUpdatedAt).toBe(2000);
    expect(formatTime(state.remainingSeconds)).toBe("01:30");
  });

  test("timer can be edited to 0:01 while paused", () => {
    const state = setPomodoroDurationSeconds(
      createInitialPomodoroState(1000),
      parsePomodoroTimeInput("0:01"),
      2000
    );

    expect(state.remainingSeconds).toBe(1);
    expect(state.durationSeconds).toBe(1);
    expect(state.isRunning).toBe(false);
    expect(formatTime(state.remainingSeconds)).toBe("00:01");
  });

  test("duration cannot be changed while running", () => {
    const running = startPomodoro(createInitialPomodoroState(1000), 1000);
    const state = setPomodoroDurationSeconds(running, 90, 2000);

    expect(state).toEqual(running);
  });

  test("invalid duration values are rejected safely", () => {
    const state = createInitialPomodoroState(1000);

    expect(setPomodoroDurationSeconds(state, 0)).toEqual(state);
    expect(setPomodoroDurationSeconds(state, -1)).toEqual(state);
    expect(setPomodoroDurationSeconds(state, "")).toEqual(state);
    expect(setPomodoroDurationSeconds(state, "abc")).toEqual(state);
    expect(setPomodoroDurationSeconds(state, 180 * 60 + 1)).toEqual(state);
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
    expect(state.durationSeconds).toBe(POMODORO_DEFAULT_DURATION_SECONDS);
    expect(state.isRunning).toBe(false);
    expect(state.lastUpdatedAt).toBe(3000);
  });

  test("reset returns to the selected duration", () => {
    const custom = setPomodoroDurationSeconds(
      createInitialPomodoroState(1000),
      90
    );
    const state = resetPomodoro(custom, 3000);

    expect(state.remainingSeconds).toBe(90);
    expect(state.durationSeconds).toBe(90);
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
      durationSeconds: 1200,
      isRunning: false,
      lastUpdatedAt: 5000,
      completionFired: false,
    };

    expect(restorePomodoroState(saved, 10000)).toEqual(saved);
  });

  test("saved custom duration restores correctly", () => {
    const saved = {
      remainingSeconds: 300,
      durationSeconds: 300,
      isRunning: false,
      lastUpdatedAt: 5000,
      completionFired: false,
    };

    expect(restorePomodoroState(saved, 10000)).toEqual(saved);
  });

  test("invalid zero-second saved state restores to 25:00 paused", () => {
    const saved = {
      remainingSeconds: 0,
      durationSeconds: 0,
      isRunning: false,
      lastUpdatedAt: 5000,
      completionFired: false,
    };
    const state = restorePomodoroState(saved, 10000);

    expect(state.remainingSeconds).toBe(POMODORO_DEFAULT_DURATION_SECONDS);
    expect(state.durationSeconds).toBe(POMODORO_DEFAULT_DURATION_SECONDS);
    expect(state.isRunning).toBe(false);
    expect(formatTime(state.remainingSeconds)).toBe("25:00");
  });

  test("completed saved state restores to 25:00 paused by default", () => {
    const saved = {
      remainingSeconds: 0,
      durationSeconds: 1,
      isRunning: false,
      lastUpdatedAt: 5000,
      completionFired: true,
    };
    const state = restorePomodoroState(saved, 10000);

    expect(state.remainingSeconds).toBe(POMODORO_DEFAULT_DURATION_SECONDS);
    expect(state.durationSeconds).toBe(POMODORO_DEFAULT_DURATION_SECONDS);
    expect(state.isRunning).toBe(false);
    expect(formatTime(state.remainingSeconds)).toBe("25:00");
  });

  test("completed state can be preserved for the live completion display", () => {
    const saved = {
      remainingSeconds: 0,
      durationSeconds: 1,
      isRunning: false,
      lastUpdatedAt: 5000,
      completionFired: true,
    };
    const state = restorePomodoroState(saved, 10000, {
      preserveCompleted: true,
    });

    expect(state.remainingSeconds).toBe(0);
    expect(state.durationSeconds).toBe(1);
    expect(state.isRunning).toBe(false);
    expect(formatTime(state.remainingSeconds)).toBe("00:00");
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
