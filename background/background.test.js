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
          if (Array.isArray(keys)) {
            callback(
              Object.fromEntries(keys.map((key) => [key, storage[key]]))
            );
            return;
          }

          if (typeof keys === "string") {
            callback({ [keys]: storage[keys] });
            return;
          }

          callback({ ...storage });
        }),
        set: jest.fn((values, callback) => {
          Object.assign(storage, values);

          if (callback) {
            callback();
          }
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
      "focuskit-pomodoro-complete",
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

    expect(result).toEqual({
      success: false,
      error: "Notifications are blocked",
    });
    expect(chrome.__storage.lastPomodoroNotificationError).toBe(
      "Notifications are blocked"
    );
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
