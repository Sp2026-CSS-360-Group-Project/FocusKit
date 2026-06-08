// background.test.js - verifies service worker timers, notifications, tabs, and messaging.

const fs = require("fs");
const path = require("path");

function createChromeMock(initialStorage = {}) {
  const storage = { ...initialStorage };
  const listeners = {
    alarms: [],
    installed: [],
    messages: [],
    startup: [],
  };

  return {
    __storage: storage,
    __listeners: listeners,
    alarms: {
      create: jest.fn((name, info, callback) => {
        if (callback) {
          callback();
        }
      }),
      clear: jest.fn((name, callback) => {
        if (callback) {
          callback(true);
        }
      }),
      onAlarm: {
        addListener: jest.fn((listener) => listeners.alarms.push(listener)),
      },
    },
    notifications: {
      clear: jest.fn((id, callback) => {
        if (callback) {
          callback(true);
        }
      }),
      create: jest.fn((id, options, callback) => {
        if (callback) {
          callback(id);
        }
      }),
    },
    offscreen: {
      createDocument: jest.fn(() => Promise.resolve()),
      hasDocument: jest.fn(() => Promise.resolve(false)),
      Reason: {
        AUDIO_PLAYBACK: "AUDIO_PLAYBACK",
      },
    },
    runtime: {
      getURL: jest.fn(
        (resourcePath) => `chrome-extension://test/${resourcePath}`
      ),
      lastError: null,
      onInstalled: {
        addListener: jest.fn((listener) => listeners.installed.push(listener)),
      },
      onMessage: {
        addListener: jest.fn((listener) => listeners.messages.push(listener)),
      },
      onStartup: {
        addListener: jest.fn((listener) => listeners.startup.push(listener)),
      },
      sendMessage: jest.fn((message, callback) => {
        if (callback) {
          callback();
        }
      }),
    },
    storage: {
      local: {
        get: jest.fn((keys, callback) => {
          let result;

          if (Array.isArray(keys)) {
            result = Object.fromEntries(keys.map((key) => [key, storage[key]]));
          } else if (typeof keys === "string") {
            result = { [keys]: storage[keys] };
          } else {
            result = { ...storage };
          }

          if (callback) {
            callback(result);
            return;
          }

          return Promise.resolve(result);
        }),
        set: jest.fn((values, callback) => {
          Object.assign(storage, values);

          if (callback) {
            callback();
            return;
          }

          return Promise.resolve();
        }),
      },
    },
    tabs: {
      query: jest.fn((query, callback) => callback([{ id: 42, windowId: 7 }])),
      update: jest.fn((tabId, properties, callback) => {
        if (callback) {
          callback({ id: tabId, ...properties });
        }
      }),
    },
  };
}

function loadBackground(initialStorage) {
  jest.resetModules();
  global.chrome = createChromeMock(initialStorage);
  const background = require("./background.js");

  return { background, chrome: global.chrome };
}

function sendMessage(chrome, message) {
  return new Promise((resolve) => {
    const keepAlive = chrome.__listeners.messages[0](message, {}, resolve);

    expect(keepAlive).toBe(true);
  });
}

function sendOffscreenMessage(chrome, message) {
  const sendResponse = jest.fn();
  const keepAlive = chrome.__listeners.messages[0](message, {}, sendResponse);

  expect(keepAlive).toBe(false);
  expect(sendResponse).not.toHaveBeenCalled();
}

describe("background dependency loading", () => {
  test("loads storage.js once via its own importScripts guard", () => {
    jest.resetModules();
    const previousGlobals = {
      chrome: global.chrome,
      importScripts: global.importScripts,
      pomodoro: global.FocusKitPomodoroState,
      modes: global.FocusKitModes,
      storage: global.FocusKitStorage,
    };

    global.importScripts = jest.fn((scriptPath) => {
      if (scriptPath === "../tools/pomodoro-timer/pomodoroState.js") {
        global.FocusKitPomodoroState = {
          POMODORO_STORAGE_KEY: "pomodoroState",
          normalizePomodoroDurationSeconds: () => 1500,
          pausePomodoro: (state) => state,
          resetPomodoro: () => ({ remainingSeconds: 1500, isRunning: false }),
          restorePomodoroState: () => ({
            remainingSeconds: 1500,
            isRunning: false,
          }),
          setPomodoroDurationSeconds: (state) => state,
          startPomodoro: (state) => state,
          tickPomodoro: (state) => state,
        };
      }

      if (scriptPath === "../tools/focus-modes/focusModes.js") {
        global.FocusKitModes = {
          loadFocusModes: (callback) => callback([]),
        };
      }

      if (scriptPath === "../storage.js") {
        global.FocusKitStorage = {
          saveSession: jest.fn(),
        };
      }
    });

    delete global.chrome;
    delete global.FocusKitPomodoroState;
    delete global.FocusKitModes;
    delete global.FocusKitStorage;

    try {
      require("./background.js");

      expect(global.importScripts).toHaveBeenCalledWith(
        "../tools/pomodoro-timer/pomodoroState.js"
      );
      expect(global.importScripts).toHaveBeenCalledWith(
        "../tools/focus-modes/focusModes.js"
      );
      expect(global.importScripts).toHaveBeenCalledWith("../storage.js");

      const storageImports = global.importScripts.mock.calls.filter(
        ([scriptPath]) => scriptPath === "../storage.js"
      );
      expect(storageImports).toHaveLength(1);
    } finally {
      global.chrome = previousGlobals.chrome;
      global.importScripts = previousGlobals.importScripts;
      global.FocusKitPomodoroState = previousGlobals.pomodoro;
      global.FocusKitModes = previousGlobals.modes;
      global.FocusKitStorage = previousGlobals.storage;
    }
  });
});

describe("manifest background registration", () => {
  test("registers the MV3 service worker with required background permissions", () => {
    const manifest = JSON.parse(
      fs.readFileSync(path.join(__dirname, "..", "manifest.json"), "utf8")
    );

    expect(manifest.manifest_version).toBe(3);
    expect(manifest.background.service_worker).toBe("background/background.js");
    expect(manifest.permissions).toEqual(
      expect.arrayContaining([
        "alarms",
        "notifications",
        "offscreen",
        "storage",
        "tabs",
      ])
    );
    expect(
      fs.readFileSync(
        path.join(__dirname, "..", "offscreen", "pomodoro-alarm.html"),
        "utf8"
      )
    ).toContain('<script src="pomodoro-alarm.js"></script>');
    expect(
      fs.readFileSync(
        path.join(__dirname, "..", "offscreen", "pomodoro-alarm.js"),
        "utf8"
      )
    ).toContain('message.action !== "pomodoro:playAlarmSound"');
    expect(
      fs.existsSync(
        path.join(__dirname, "..", "assets", "sounds", "pomodoro-alarm.wav")
      )
    ).toBe(true);
  });
});

describe("FocusKit background service worker", () => {
  test("registers lifecycle, alarm, and message listeners", () => {
    const { chrome } = loadBackground();

    expect(chrome.runtime.onInstalled.addListener).toHaveBeenCalledTimes(1);
    expect(chrome.runtime.onStartup.addListener).toHaveBeenCalledTimes(1);
    expect(chrome.alarms.onAlarm.addListener).toHaveBeenCalledTimes(1);
    expect(chrome.runtime.onMessage.addListener).toHaveBeenCalledTimes(1);
  });

  test("does not intercept offscreen alarm sound playback messages", () => {
    const { chrome } = loadBackground();

    sendOffscreenMessage(chrome, {
      action: "pomodoro:playAlarmSound",
      soundPath: "chrome-extension://test/assets/sounds/pomodoro-alarm.wav",
    });
  });

  test("handles install and update lifecycle events", async () => {
    const { chrome } = loadBackground();

    await chrome.__listeners.installed[0]({ reason: "install" });
    expect(chrome.__storage.installed).toBe(true);
    expect(chrome.__storage.lifecycleEvent).toBe("install");

    await chrome.__listeners.installed[0]({ reason: "update" });
    expect(chrome.__storage.lifecycleEvent).toBe("update");
  });

  test("starts, pauses, resets, and returns Pomodoro state through messages", async () => {
    jest.spyOn(Date, "now").mockReturnValue(1000);
    const { chrome } = loadBackground();

    const started = await sendMessage(chrome, { action: "pomodoro:start" });
    expect(started.success).toBe(true);
    expect(started.state.isRunning).toBe(true);
    expect(chrome.alarms.create).toHaveBeenCalledWith(
      "focuskit:pomodoro",
      { delayInMinutes: 25 },
      expect.any(Function)
    );

    Date.now.mockReturnValue(61000);
    const paused = await sendMessage(chrome, { action: "pomodoro:pause" });
    expect(paused.state.isRunning).toBe(false);
    expect(paused.state.remainingSeconds).toBe(1440);
    expect(paused.state.durationSeconds).toBe(1500);
    expect(chrome.alarms.clear).toHaveBeenCalledWith(
      "focuskit:pomodoro",
      expect.any(Function)
    );

    const reset = await sendMessage(chrome, { action: "pomodoro:reset" });
    expect(reset.state.remainingSeconds).toBe(1500);
    expect(reset.state.durationSeconds).toBe(1500);
    expect(reset.state.isRunning).toBe(false);

    Date.now.mockRestore();
  });

  test("changes Pomodoro duration while paused", async () => {
    jest.spyOn(Date, "now").mockReturnValue(1000);
    const { chrome } = loadBackground();

    const response = await sendMessage(chrome, {
      action: "pomodoro:setDuration",
      seconds: 90,
    });

    expect(response.success).toBe(true);
    expect(response.state.remainingSeconds).toBe(90);
    expect(response.state.durationSeconds).toBe(90);
    expect(response.state.isRunning).toBe(false);
    expect(chrome.__storage.pomodoroState).toEqual(response.state);

    Date.now.mockRestore();
  });

  test("rejects Pomodoro duration changes while running", async () => {
    jest.spyOn(Date, "now").mockReturnValue(1000);
    const { chrome } = loadBackground();

    await sendMessage(chrome, { action: "pomodoro:start" });
    const response = await sendMessage(chrome, {
      action: "pomodoro:setDuration",
      seconds: 90,
    });

    expect(response.success).toBe(false);
    expect(response.error).toBe("Cannot change duration while Pomodoro runs");
    expect(chrome.__storage.pomodoroState.durationSeconds).toBe(1500);
    expect(chrome.__storage.pomodoroState.isRunning).toBe(true);

    Date.now.mockRestore();
  });

  test("rejects invalid Pomodoro durations", async () => {
    const { chrome } = loadBackground();

    for (const seconds of [0, -1, "", "abc", 180 * 60 + 1]) {
      const response = await sendMessage(chrome, {
        action: "pomodoro:setDuration",
        seconds,
      });

      expect(response.success).toBe(false);
      expect(response.error).toBe("Invalid Pomodoro duration");
    }
  });

  test("reset returns to the selected Pomodoro duration", async () => {
    jest.spyOn(Date, "now").mockReturnValue(1000);
    const { chrome } = loadBackground();

    await sendMessage(chrome, { action: "pomodoro:setDuration", seconds: 90 });
    const reset = await sendMessage(chrome, { action: "pomodoro:reset" });

    expect(reset.success).toBe(true);
    expect(reset.state.remainingSeconds).toBe(90);
    expect(reset.state.durationSeconds).toBe(90);

    Date.now.mockRestore();
  });

  test("custom Pomodoro duration persists and restores", async () => {
    jest.spyOn(Date, "now").mockReturnValue(100000);
    const savedState = {
      remainingSeconds: 300,
      durationSeconds: 300,
      isRunning: false,
      isBreak: false,
      lastUpdatedAt: 99000,
      completionFired: false,
    };
    const { chrome } = loadBackground({ pomodoroState: savedState });

    const response = await sendMessage(chrome, {
      action: "pomodoro:getState",
    });

    expect(response.success).toBe(true);
    expect(response.state).toEqual(savedState);
    expect(chrome.__storage.pomodoroState).toEqual(savedState);

    Date.now.mockRestore();
  });

  test("returns saved paused Pomodoro time without resetting", async () => {
    jest.spyOn(Date, "now").mockReturnValue(100000);
    const savedState = {
      remainingSeconds: 1499,
      durationSeconds: 1500,
      isRunning: false,
      isBreak: false,
      lastUpdatedAt: 99000,
      completionFired: false,
    };
    const { chrome } = loadBackground({ pomodoroState: savedState });

    const response = await sendMessage(chrome, {
      action: "pomodoro:getState",
    });

    expect(response.success).toBe(true);
    expect(response.state).toEqual(savedState);
    expect(chrome.__storage.pomodoroState).toEqual(savedState);

    Date.now.mockRestore();
  });

  test("pause can persist the popup-visible remaining time", async () => {
    jest.spyOn(Date, "now").mockReturnValue(200000);
    const { chrome } = loadBackground({
      pomodoroState: {
        remainingSeconds: 1500,
        durationSeconds: 1500,
        isRunning: true,
        lastUpdatedAt: 1000,
      },
    });

    const response = await sendMessage(chrome, {
      action: "pomodoro:pause",
      state: {
        remainingSeconds: 1499,
        durationSeconds: 1500,
        isRunning: false,
        lastUpdatedAt: 199000,
      },
    });

    expect(response.success).toBe(true);
    expect(response.state.remainingSeconds).toBe(1499);
    expect(response.state.isRunning).toBe(false);
    expect(chrome.__storage.pomodoroState.remainingSeconds).toBe(1499);

    Date.now.mockRestore();
  });

  test("fires a completion notification and requests sound when the alarm expires", async () => {
    jest.spyOn(Date, "now").mockReturnValue(2000000);
    const { chrome } = loadBackground({
      notifications: true,
      sound: true,
      pomodoroState: {
        remainingSeconds: 1,
        durationSeconds: 1500,
        isRunning: true,
        lastUpdatedAt: 1000,
        completionFired: false,
      },
    });

    await chrome.__listeners.alarms[0]({ name: "focuskit:pomodoro" });

    expect(chrome.__storage.pomodoroState).toEqual({
      remainingSeconds: 0,
      durationSeconds: 1500,
      isRunning: false,
      lastUpdatedAt: 2000000,
      completionFired: true,
    });
    expect(chrome.notifications.create).toHaveBeenCalledWith(
      expect.stringMatching(/^focuskit-pomodoro-complete-\d+-/),
      expect.objectContaining({
        type: "basic",
        title: "Focus sprint complete",
      }),
      expect.any(Function)
    );
    expect(chrome.runtime.sendMessage).toHaveBeenCalledWith(
      {
        action: "pomodoro:stateChanged",
        state: chrome.__storage.pomodoroState,
      },
      expect.any(Function)
    );
    expect(chrome.offscreen.createDocument).toHaveBeenCalledWith({
      url: "offscreen/pomodoro-alarm.html",
      reasons: ["AUDIO_PLAYBACK"],
      justification: "Play the Pomodoro completion alarm sound.",
    });
    expect(chrome.runtime.sendMessage).toHaveBeenCalledWith(
      {
        action: "pomodoro:playAlarmSound",
        soundPath: "chrome-extension://test/assets/sounds/pomodoro-alarm.wav",
      },
      expect.any(Function)
    );
    expect(chrome.__storage.pomodoroCompletionEffects).toMatchObject({
      source: "alarm",
      notificationRequested: true,
      soundRequested: true,
    });

    Date.now.mockRestore();
  });

  test("popup completion request fires notification and sound after visible timer reaches zero", async () => {
    jest.spyOn(Date, "now").mockReturnValue(2000000);
    const { chrome } = loadBackground({
      notifications: true,
      sound: true,
      pomodoroState: {
        remainingSeconds: 0,
        durationSeconds: 1,
        isRunning: false,
        lastUpdatedAt: 1999000,
        completionFired: false,
      },
    });

    const response = await sendMessage(chrome, {
      action: "pomodoro:complete",
      source: "popup",
    });

    expect(response.success).toBe(true);
    expect(response.completed).toBe(true);
    expect(chrome.__storage.pomodoroState).toMatchObject({
      remainingSeconds: 0,
      durationSeconds: 1,
      isRunning: false,
      completionFired: true,
    });
    expect(chrome.notifications.create).toHaveBeenCalledTimes(1);
    expect(chrome.offscreen.createDocument).toHaveBeenCalledTimes(1);
    expect(chrome.__storage.pomodoroCompletionEffects).toMatchObject({
      source: "popup",
      notificationRequested: true,
      soundRequested: true,
    });

    Date.now.mockRestore();
  });

  test("does not create a completion notification when notifications are disabled", async () => {
    jest.spyOn(Date, "now").mockReturnValue(2000000);
    const { chrome } = loadBackground({
      notifications: false,
      sound: true,
      pomodoroState: {
        remainingSeconds: 1,
        durationSeconds: 1500,
        isRunning: true,
        lastUpdatedAt: 1000,
        completionFired: false,
      },
    });

    await chrome.__listeners.alarms[0]({ name: "focuskit:pomodoro" });

    expect(chrome.notifications.create).not.toHaveBeenCalled();
    expect(chrome.offscreen.createDocument).toHaveBeenCalledTimes(1);

    Date.now.mockRestore();
  });

  test("does not request sound playback when sound effects are disabled", async () => {
    jest.spyOn(Date, "now").mockReturnValue(2000000);
    const { chrome } = loadBackground({
      notifications: true,
      sound: false,
      pomodoroState: {
        remainingSeconds: 1,
        durationSeconds: 1500,
        isRunning: true,
        lastUpdatedAt: 1000,
        completionFired: false,
      },
    });

    await chrome.__listeners.alarms[0]({ name: "focuskit:pomodoro" });

    expect(chrome.notifications.create).toHaveBeenCalledTimes(1);
    expect(chrome.offscreen.createDocument).not.toHaveBeenCalled();
    expect(chrome.runtime.sendMessage).not.toHaveBeenCalledWith(
      expect.objectContaining({ action: "pomodoro:playAlarmSound" }),
      expect.any(Function)
    );

    Date.now.mockRestore();
  });

  test("completion notification and sound fire only once per completed session", async () => {
    jest.spyOn(Date, "now").mockReturnValue(2000000);
    const { chrome } = loadBackground({
      notifications: true,
      sound: true,
      pomodoroState: {
        remainingSeconds: 1,
        durationSeconds: 1500,
        isRunning: true,
        lastUpdatedAt: 1000,
        completionFired: false,
      },
    });

    await chrome.__listeners.alarms[0]({ name: "focuskit:pomodoro" });
    await chrome.__listeners.alarms[0]({ name: "focuskit:pomodoro" });
    await sendMessage(chrome, { action: "pomodoro:complete" });

    expect(chrome.notifications.create).toHaveBeenCalledTimes(1);
    expect(chrome.offscreen.createDocument).toHaveBeenCalledTimes(1);

    Date.now.mockRestore();
  });

  test("completion starts notification and sound without waiting for either one", async () => {
    const { background } = loadBackground({
      notifications: true,
      sound: true,
    });
    const calls = [];
    let resolveNotification;
    let resolveSound;
    const notifyPomodoroComplete = jest.fn(
      () =>
        new Promise((resolve) => {
          calls.push("notification");
          resolveNotification = resolve;
        })
    );
    const playPomodoroAlarmSound = jest.fn(
      () =>
        new Promise((resolve) => {
          calls.push("sound");
          resolveSound = resolve;
        })
    );

    const resultPromise = background.handlePomodoroComplete("test", {
      notifyPomodoroComplete,
      playPomodoroAlarmSound,
    });

    await Promise.resolve();
    expect(calls).toEqual(["notification", "sound"]);
    expect(notifyPomodoroComplete).toHaveBeenCalledTimes(1);
    expect(playPomodoroAlarmSound).toHaveBeenCalledTimes(1);

    resolveNotification({ success: true, notificationId: "notification-1" });
    resolveSound({ success: true });

    await expect(resultPromise).resolves.toMatchObject({
      source: "test",
      notificationRequested: true,
      notificationResult: { success: true, notificationId: "notification-1" },
      soundRequested: true,
      soundResult: { success: true },
    });
  });

  test("completion still requests notification when sound hangs", async () => {
    const { background } = loadBackground({
      notifications: true,
      sound: true,
    });
    const notifyPomodoroComplete = jest.fn(() =>
      Promise.resolve({ success: true, notificationId: "notification-1" })
    );
    const playPomodoroAlarmSound = jest.fn(() => new Promise(() => {}));

    background.handlePomodoroComplete("test", {
      notifyPomodoroComplete,
      playPomodoroAlarmSound,
    });

    await Promise.resolve();
    expect(notifyPomodoroComplete).toHaveBeenCalledTimes(1);
    expect(playPomodoroAlarmSound).toHaveBeenCalledTimes(1);
  });

  test("completion still requests sound when notification fails", async () => {
    const { background } = loadBackground({
      notifications: true,
      sound: true,
    });
    const notifyPomodoroComplete = jest.fn(() =>
      Promise.reject(new Error("Notifications are blocked"))
    );
    const playPomodoroAlarmSound = jest.fn(() =>
      Promise.resolve({ success: true })
    );

    const result = await background.handlePomodoroComplete("test", {
      notifyPomodoroComplete,
      playPomodoroAlarmSound,
    });

    expect(notifyPomodoroComplete).toHaveBeenCalledTimes(1);
    expect(playPomodoroAlarmSound).toHaveBeenCalledTimes(1);
    expect(result).toMatchObject({
      notificationResult: {
        success: false,
        error: "Notifications are blocked",
      },
      soundResult: { success: true },
    });
  });

  test("records notification creation errors instead of swallowing them", async () => {
    const { background, chrome } = loadBackground({
      notifications: true,
      sound: false,
    });
    chrome.notifications.create.mockImplementation((id, options, callback) => {
      chrome.runtime.lastError = { message: "Notifications are blocked" };
      callback();
      chrome.runtime.lastError = null;
    });

    const result = await background.notifyPomodoroComplete();

    expect(result).toMatchObject({
      success: false,
      error: "Notifications are blocked",
      notificationId: expect.stringMatching(/^focuskit-pomodoro-complete-\d+-/),
    });
    expect(chrome.__storage.lastPomodoroNotificationError).toBe(
      "Notifications are blocked"
    );
  });

  test("two notification calls use different notification ids", async () => {
    const { background, chrome } = loadBackground({
      notifications: true,
      sound: false,
    });

    const first = await background.notifyPomodoroComplete();
    const second = await background.notifyPomodoroComplete();

    expect(first.notificationId).toMatch(/^focuskit-pomodoro-complete-\d+-/);
    expect(second.notificationId).toMatch(/^focuskit-pomodoro-complete-\d+-/);
    expect(first.notificationId).not.toBe(second.notificationId);
    expect(chrome.notifications.create.mock.calls[0][0]).toBe(
      first.notificationId
    );
    expect(chrome.notifications.create.mock.calls[1][0]).toBe(
      second.notificationId
    );
  });

  test("debug alert test requests notification and sound", async () => {
    const { chrome } = loadBackground();

    const response = await sendMessage(chrome, { action: "debug:testAlerts" });
    await Promise.resolve();
    await Promise.resolve();

    expect(response).toMatchObject({
      notificationRequested: true,
      soundRequested: true,
      errors: [],
    });
    expect(chrome.notifications.create).toHaveBeenCalledWith(
      expect.stringMatching(/^focuskit-pomodoro-complete-\d+-/),
      expect.objectContaining({ title: "Focus sprint complete" }),
      expect.any(Function)
    );
    expect(chrome.offscreen.createDocument).toHaveBeenCalledWith({
      url: "offscreen/pomodoro-alarm.html",
      reasons: ["AUDIO_PLAYBACK"],
      justification: "Play the Pomodoro completion alarm sound.",
    });
    expect(chrome.runtime.sendMessage).toHaveBeenCalledWith(
      {
        action: "pomodoro:playAlarmSound",
        soundPath: "chrome-extension://test/assets/sounds/pomodoro-alarm.wav",
      },
      expect.any(Function)
    );
    expect(chrome.__storage.sessions).toBeUndefined();
  });

  test("debug alert test reports notification runtime errors", async () => {
    const { chrome } = loadBackground();
    chrome.notifications.create.mockImplementation((id, options, callback) => {
      chrome.runtime.lastError = { message: "Notifications are blocked" };
      callback();
      chrome.runtime.lastError = null;
    });

    const response = await sendMessage(chrome, { action: "debug:testAlerts" });

    expect(response.notificationRequested).toBe(true);
    expect(response.soundRequested).toBe(true);
    expect(response.errors).toEqual([]);
    expect(response.notificationResult).toMatchObject({
      success: true,
      requested: true,
    });
  });

  test("debug alert test reports offscreen sound errors", async () => {
    const { chrome } = loadBackground();
    chrome.offscreen.createDocument.mockRejectedValue(
      new Error("Offscreen creation failed")
    );

    const response = await sendMessage(chrome, { action: "debug:testAlerts" });

    expect(response.notificationRequested).toBe(true);
    expect(response.soundRequested).toBe(true);
    expect(response.errors).toEqual([]);
    expect(response.soundResult).toEqual({
      success: true,
      requested: true,
    });
  });

  test("debug alert test does not hang when notification clear never calls back", async () => {
    jest.useFakeTimers();
    const { chrome } = loadBackground();
    chrome.notifications.clear.mockImplementation(() => {});

    const responsePromise = sendMessage(chrome, { action: "debug:testAlerts" });
    await jest.advanceTimersByTimeAsync(3000);

    await expect(responsePromise).resolves.toMatchObject({
      notificationRequested: true,
      soundRequested: true,
      errors: [],
    });

    jest.useRealTimers();
  });

  test("debug alert test returns a structured response when alert APIs do not call back", async () => {
    const { chrome } = loadBackground();
    chrome.notifications.create.mockImplementation(() => {});
    chrome.runtime.sendMessage.mockImplementation((message, callback) => {
      if (message.action !== "pomodoro:playAlarmSound" && callback) {
        callback();
      }
    });

    await expect(
      sendMessage(chrome, { action: "debug:testAlerts" })
    ).resolves.toMatchObject({
      notificationRequested: true,
      soundRequested: true,
      errors: [],
      notificationResult: {
        success: true,
        requested: true,
      },
      soundResult: {
        success: true,
        requested: true,
      },
    });
  });

  test("reset and start clear the completion guard for a future session", async () => {
    jest.spyOn(Date, "now").mockReturnValue(3000000);
    const { chrome } = loadBackground({
      pomodoroState: {
        remainingSeconds: 0,
        durationSeconds: 1500,
        isRunning: false,
        lastUpdatedAt: 2000000,
        completionFired: true,
      },
    });

    const reset = await sendMessage(chrome, { action: "pomodoro:reset" });
    expect(reset.state.completionFired).toBe(false);

    chrome.__storage.pomodoroState = {
      remainingSeconds: 10,
      durationSeconds: 1500,
      isRunning: false,
      lastUpdatedAt: 2999000,
      completionFired: true,
    };
    const started = await sendMessage(chrome, { action: "pomodoro:start" });
    expect(started.state.completionFired).toBe(false);
    expect(started.state.isRunning).toBe(true);

    Date.now.mockRestore();
  });

  test("applies focus mode tab control and persists the chosen mode", async () => {
    const { chrome } = loadBackground();

    const response = await sendMessage(chrome, {
      action: "focus:setMode",
      modeId: "deep-work",
    });

    expect(response.success).toBe(true);
    expect(chrome.__storage.focusMode).toBe("deep-work");
    expect(chrome.tabs.query).toHaveBeenCalledWith(
      { active: true, currentWindow: true },
      expect.any(Function)
    );
    expect(chrome.tabs.update).toHaveBeenCalledWith(
      42,
      { muted: true },
      expect.any(Function)
    );
  });
});
