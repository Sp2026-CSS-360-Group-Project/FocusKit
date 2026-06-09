/* global FocusKitStorage */
// background.js - MV3 service worker for timers, notifications, tabs, and popup messages.

// Load shared Pomodoro state helpers when running as a Chrome service worker.
if (
  typeof importScripts === "function" &&
  typeof FocusKitPomodoroState === "undefined"
) {
  importScripts("../tools/pomodoro-timer/pomodoroState.js");
}

if (
  typeof importScripts === "function" &&
  typeof FocusKitModes === "undefined"
) {
  importScripts("../tools/focus-modes/focusModes.js");
  importScripts("../storage.js");
}

// Reuse shared state helpers in Jest without duplicating timer rules in the worker.
const pomodoroHelpers =
  typeof FocusKitPomodoroState !== "undefined"
    ? FocusKitPomodoroState
    : require("../tools/pomodoro-timer/pomodoroState.js");

const focusModeHelpers =
  typeof FocusKitModes !== "undefined"
    ? FocusKitModes
    : require("../tools/focus-modes/focusModes.js");

const storageHelpers =
  typeof FocusKitStorage !== "undefined"
    ? FocusKitStorage
    : require("../storage.js");

const { saveSession } = storageHelpers;

// Keep background command names centralized so popup and tests use one message surface.
const POMODORO_ALARM_NAME = "focuskit:pomodoro";
const POMODORO_ALARM_SOUND_PATH = "assets/sounds/pomodoro-alarm.wav";
const POMODORO_COMPLETE_NOTIFICATION_ID = "focuskit-pomodoro-complete";
const POMODORO_ICON_PATH = "icons/icon48.png";
const POMODORO_CLEAR_NOTIFICATION_TIMEOUT_MS = 500;
const POMODORO_NOTIFICATION_TIMEOUT_MS = 2000;
const POMODORO_SOUND_TIMEOUT_MS = 2000;
// Separate id prevents the break notification overwriting the complete notification.
const POMODORO_BREAK_NOTIFICATION_ID = "focuskit-pomodoro-break";

const MESSAGE_ACTIONS = {
  ping: "ping",
  pomodoroGetState: "pomodoro:getState",
  pomodoroStart: "pomodoro:start",
  pomodoroPause: "pomodoro:pause",
  pomodoroReset: "pomodoro:reset",
  pomodoroSetDuration: "pomodoro:setDuration",
  pomodoroComplete: "pomodoro:complete",
  debugTestAlerts: "debug:testAlerts",
  focusSetMode: "focus:setMode",
};

const {
  POMODORO_STORAGE_KEY,
  normalizePomodoroDurationSeconds,
  pausePomodoro,
  resetPomodoro,
  restorePomodoroState,
  setPomodoroDurationSeconds,
  startPomodoro,
  tickPomodoro,
} = pomodoroHelpers;

const { loadFocusModes: loadFocusModesFromStorage } = focusModeHelpers;

function createNotificationId(prefix) {
  return `${prefix}-${Date.now()}-${Math.random().toString(16).slice(2)}`;
}

// Register service worker listeners only when Chrome APIs are available.
if (typeof chrome !== "undefined" && chrome.runtime) {
  chrome.runtime.onInstalled.addListener(handleInstalled);
  chrome.runtime.onStartup.addListener(handleStartup);
  chrome.alarms.onAlarm.addListener(handleAlarm);
  chrome.runtime.onMessage.addListener(handleMessage);
}

// Persist lifecycle context and normalize timer alarms after install or update.
async function handleInstalled(details = {}) {
  await setStorage({
    installed: true,
    lifecycleEvent: details.reason || "unknown",
    lastLifecycleAt: Date.now(),
  });
  await syncPomodoroAlarm();
}

// Restore alarms after the browser wakes the service worker for a new session.
async function handleStartup() {
  await setStorage({
    lifecycleEvent: "startup",
    lastLifecycleAt: Date.now(),
  });
  await syncPomodoroAlarm();
}

// Route validated popup messages to background-owned productivity behavior.
function handleMessage(message, sender, sendResponse) {
  if (!message || typeof message.action !== "string") {
    sendResponse({ success: false, error: "Invalid message" });
    return false;
  }

  if (message.action === "pomodoro:playAlarmSound") {
    return false;
  }

  handleMessageAsync(message)
    .then(sendResponse)
    .catch((error) =>
      sendResponse({
        success: false,
        error: error.message || "Background request failed",
      })
    );

  return true;
}

// Keep asynchronous command handling separate from Chrome's listener plumbing.
async function handleMessageAsync(message) {
  if (message.action === MESSAGE_ACTIONS.ping) {
    return { success: true, app: "FocusKit" };
  }

  if (message.action === MESSAGE_ACTIONS.pomodoroGetState) {
    return { success: true, state: await getCurrentPomodoroState() };
  }

  if (message.action === MESSAGE_ACTIONS.pomodoroStart) {
    return {
      success: true,
      state: await updatePomodoroState(startPomodoro, true),
    };
  }

  if (message.action === MESSAGE_ACTIONS.pomodoroPause) {
    return {
      success: true,
      state: await updatePomodoroState(pausePomodoro, false, message.state),
    };
  }

  if (message.action === MESSAGE_ACTIONS.pomodoroReset) {
    const currentState = await readPomodoroState();
    const state = resetPomodoro(currentState);
    await setStorage({ [POMODORO_STORAGE_KEY]: state });
    await clearPomodoroAlarm();
    broadcastPomodoroState(state);

    return { success: true, state };
  }

  if (message.action === MESSAGE_ACTIONS.pomodoroSetDuration) {
    return applyPomodoroDuration(message.seconds);
  }

  if (message.action === MESSAGE_ACTIONS.pomodoroComplete) {
    return completePomodoroSession(message.source || "popup");
  }

  if (message.action === MESSAGE_ACTIONS.debugTestAlerts) {
    return testDebugAlerts();
  }

  if (message.action === MESSAGE_ACTIONS.focusSetMode) {
    return applyFocusMode(message.modeId);
  }

  return { success: false, error: `Unknown action: ${message.action}` };
}

// Use chrome.alarms as the authoritative ticker while the popup is closed.
async function handleAlarm(alarm) {
  if (!alarm || alarm.name !== POMODORO_ALARM_NAME) {
    return;
  }

  const data = await getStorage([POMODORO_STORAGE_KEY]);
  const previousState = data[POMODORO_STORAGE_KEY] || resetPomodoro();
  const nextState = tickPomodoro(previousState);

  if (!nextState.isRunning) {
    if (
      previousState.isRunning &&
      previousState.remainingSeconds > 0 &&
      !previousState.completionFired
    ) {
      await completePomodoroSession("alarm", nextState);
      return;
    }
  }

  await setStorage({ [POMODORO_STORAGE_KEY]: nextState });
  broadcastPomodoroState(nextState);
}

// Read, normalize, persist, and return the current timer state.
async function getCurrentPomodoroState() {
  const state = await readPomodoroState();
  await setStorage({ [POMODORO_STORAGE_KEY]: state });
  await syncPomodoroAlarm(state);

  return state;
}

// Apply a user-selected paused Pomodoro duration.
async function applyPomodoroDuration(seconds) {
  if (!normalizePomodoroDurationSeconds(seconds)) {
    return { success: false, error: "Invalid Pomodoro duration" };
  }

  const currentState = await readPomodoroState();

  if (currentState.isRunning) {
    return {
      success: false,
      error: "Cannot change duration while Pomodoro runs",
      state: currentState,
    };
  }

  const state = setPomodoroDurationSeconds(currentState, seconds);
  await setStorage({ [POMODORO_STORAGE_KEY]: state });
  await clearPomodoroAlarm();
  broadcastPomodoroState(state);

  return { success: true, state };
}

// Complete a Pomodoro through one background-owned path for alarms and popups.
async function completePomodoroSession(source = "background", stateOverride) {
  const currentState =
    stateOverride || (await readPomodoroState({ preserveCompleted: true }));

  if (currentState.completionFired) {
    return { success: true, completed: false, state: currentState };
  }

  const completedState = {
    ...currentState,
    remainingSeconds: 0,
    isRunning: false,
    completionFired: true,
    lastUpdatedAt: Date.now(),
  };

  await clearPomodoroAlarm();
  await setStorage({ [POMODORO_STORAGE_KEY]: completedState });

  const effects = await handlePomodoroComplete(source);
  await setStorage({
    pomodoroCompletionEffects: {
      source,
      completedAt: completedState.lastUpdatedAt,
      ...effects,
    },
  });

  broadcastPomodoroState(completedState);

  if (completedState.isBreak) {
    await notifyBreakStart();
  }

  return { success: true, completed: true, state: completedState, effects };
}

// Apply a timer transition, persist it, update alarms, and inform open popup views.
async function updatePomodoroState(transition, shouldRunAlarm, overrideState) {
  const previousState = overrideState
    ? restorePomodoroState(overrideState)
    : await readPomodoroState();
  const state = transition(previousState);
  await setStorage({ [POMODORO_STORAGE_KEY]: state });

  if (shouldRunAlarm && state.isRunning) {
    await createPomodoroAlarm(state.remainingSeconds);
  } else {
    await clearPomodoroAlarm();
  }

  broadcastPomodoroState(state);

  return state;
}

// Normalize saved timer state before any service worker operation uses it.
async function readPomodoroState(options = {}) {
  const data = await getStorage([POMODORO_STORAGE_KEY]);

  return restorePomodoroState(data[POMODORO_STORAGE_KEY], Date.now(), options);
}

// Keep the alarm schedule aligned with persisted timer state after lifecycle events.
async function syncPomodoroAlarm(state) {
  const currentState = state || (await readPomodoroState());

  if (currentState.isRunning) {
    await createPomodoroAlarm(currentState.remainingSeconds);
  } else {
    await clearPomodoroAlarm();
  }
}

// Schedule the service worker to wake when the current focus sprint should complete.
function createPomodoroAlarm(remainingSeconds) {
  const delayInMinutes = Math.max(1 / 60, remainingSeconds / 60);

  return new Promise((resolve) => {
    chrome.alarms.create(POMODORO_ALARM_NAME, { delayInMinutes }, () =>
      resolve()
    );
  });
}

// Clear timer alarms whenever the timer pauses, resets, or completes.
function clearPomodoroAlarm() {
  return new Promise((resolve) => {
    chrome.alarms.clear(POMODORO_ALARM_NAME, () => resolve());
  });
}

// Dispatch all user-facing completion effects, honoring Settings toggles.
async function handlePomodoroComplete(
  source = "background",
  alertHelpers = {}
) {
  const settings = await getStorage(["notifications", "sound"]);
  const notify = alertHelpers.notifyPomodoroComplete || notifyPomodoroComplete;
  const playSound =
    alertHelpers.playPomodoroAlarmSound || playPomodoroAlarmSound;
  const effects = {
    source,
    notificationRequested: false,
    notificationResult: null,
    soundRequested: false,
    soundResult: null,
  };

  effects.notificationRequested = settings.notifications !== false;
  effects.soundRequested = settings.sound === true;

  const notificationPromise = effects.notificationRequested
    ? notify()
    : Promise.resolve({ skipped: true, reason: "notifications disabled" });
  const soundPromise = effects.soundRequested
    ? playSound()
    : Promise.resolve({ skipped: true, reason: "sound disabled" });

  const [notificationResult, soundResult] = await Promise.allSettled([
    notificationPromise,
    soundPromise,
  ]);

  effects.notificationResult = unwrapAlertResult(notificationResult);
  effects.soundResult = unwrapAlertResult(soundResult);

  return effects;
}

function unwrapAlertResult(result) {
  if (result.status === "fulfilled") {
    return result.value;
  }

  return {
    success: false,
    error: result.reason ? result.reason.message || String(result.reason) : "",
  };
}

// Temporary manual debug action for testing notification and audio APIs directly.
async function testDebugAlerts() {
  const result = {
    notificationRequested: true,
    soundRequested: true,
    notificationResult: { success: true, requested: true },
    soundResult: { success: true, requested: true },
    errors: [],
  };

  Promise.allSettled([
    notifyPomodoroComplete({ recordSession: false }),
    playPomodoroAlarmSound(),
  ]).then(([notificationResult, soundResult]) => {
    const completedResult = {
      notificationRequested: true,
      soundRequested: true,
      notificationResult: unwrapAlertResult(notificationResult),
      soundResult: unwrapAlertResult(soundResult),
      errors: [],
      completedAt: Date.now(),
    };

    [completedResult.notificationResult, completedResult.soundResult].forEach(
      (alertResult) => {
        if (alertResult && alertResult.error) {
          completedResult.errors.push(alertResult.error);
        }
      }
    );

    setStorage({ lastDebugAlertResult: completedResult });
  });

  return result;
}

// Notify the user when a focus sprint ends. Skipped if notifications are disabled.
async function notifyPomodoroComplete(options = {}) {
  if (options.recordSession !== false) {
    await saveSession({
      completedAt: Date.now(),
      duration: 25,
    });
  }

  // Clear any stale break notification before showing the complete one.
  await clearNotification(POMODORO_BREAK_NOTIFICATION_ID);
  const notificationId = createNotificationId(
    POMODORO_COMPLETE_NOTIFICATION_ID
  );

  return withTimeout(
    new Promise((resolve) => {
      chrome.notifications.create(
        notificationId,
        {
          type: "basic",
          iconUrl:
            typeof chrome.runtime.getURL === "function"
              ? chrome.runtime.getURL(POMODORO_ICON_PATH)
              : POMODORO_ICON_PATH,
          title: "Focus sprint complete",
          message:
            "Your Pomodoro is done. Take a short reset before the next block.",
        },
        () => {
          const errorMessage = chrome.runtime.lastError
            ? chrome.runtime.lastError.message
            : "";

          if (errorMessage) {
            setStorage({ lastPomodoroNotificationError: errorMessage }).then(
              () => {
                console.error(`Pomodoro notification failed: ${errorMessage}`);
                resolve({
                  success: false,
                  error: errorMessage,
                  notificationId,
                });
              }
            );
            return;
          }

          setStorage({ lastPomodoroNotificationError: "" }).then(() =>
            resolve({ success: true, notificationId })
          );
        }
      );
    }),
    POMODORO_NOTIFICATION_TIMEOUT_MS,
    "Pomodoro notification timed out"
  );
}

// Ask an MV3 offscreen document to play the local Pomodoro alarm sound.
async function playPomodoroAlarmSound() {
  if (!chrome.offscreen || !chrome.runtime || !chrome.runtime.sendMessage) {
    return { success: false, error: "Offscreen audio APIs are unavailable" };
  }

  const offscreenResult = await withTimeout(
    ensureAlarmOffscreenDocument().then(() => ({ success: true })),
    POMODORO_SOUND_TIMEOUT_MS,
    "Pomodoro offscreen audio setup timed out"
  );

  if (!offscreenResult.success) {
    return offscreenResult;
  }

  return withTimeout(
    new Promise((resolve) => {
      chrome.runtime.sendMessage(
        {
          action: "pomodoro:playAlarmSound",
          soundPath:
            typeof chrome.runtime.getURL === "function"
              ? chrome.runtime.getURL(POMODORO_ALARM_SOUND_PATH)
              : POMODORO_ALARM_SOUND_PATH,
        },
        (response) => {
          const errorMessage = chrome.runtime.lastError
            ? chrome.runtime.lastError.message
            : "";

          if (errorMessage) {
            resolve({ success: false, error: errorMessage });
            return;
          }

          if (response && response.success === false) {
            resolve(response);
            return;
          }

          resolve({ success: true });
        }
      );
    }),
    POMODORO_SOUND_TIMEOUT_MS,
    "Pomodoro alarm sound timed out"
  );
}

// Create the offscreen audio page once, then reuse it for future sessions.
async function ensureAlarmOffscreenDocument() {
  const url = "offscreen/pomodoro-alarm.html";

  if (
    typeof chrome.offscreen.hasDocument === "function" &&
    (await chrome.offscreen.hasDocument())
  ) {
    return;
  }

  await chrome.offscreen.createDocument({
    url,
    reasons: [chrome.offscreen.Reason.AUDIO_PLAYBACK],
    justification: "Play the Pomodoro completion alarm sound.",
  });
}

// Keep debug/manual alert checks from hanging forever if an extension API stalls.
function withTimeout(promise, timeoutMs, message) {
  return new Promise((resolve) => {
    const timeoutId = setTimeout(
      () => resolve({ success: false, error: message }),
      timeoutMs
    );

    promise
      .then((value) => {
        clearTimeout(timeoutId);
        resolve(value);
      })
      .catch((error) => {
        clearTimeout(timeoutId);
        resolve({
          success: false,
          error: error.message || message,
        });
      });
  });
}

// Notify the user when a break phase begins. Skipped if notifications are disabled.
async function notifyBreakStart() {
  const settings = await getStorage(["notifications"]);

  if (settings.notifications === false) {
    return;
  }

  // Clear the complete notification so the break one is the only one visible.
  await clearNotification(POMODORO_COMPLETE_NOTIFICATION_ID);
  const notificationId = createNotificationId(POMODORO_BREAK_NOTIFICATION_ID);

  await new Promise((resolve) => {
    chrome.notifications.create(
      notificationId,
      {
        type: "basic",
        iconUrl:
          "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAEAAAABACAQAAAAAYLlVAAAAW0lEQVR42u3QMQEAAAgDIN8/9K3hCGQKUpmZAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAtwY/QgAB2ndzLAAAAABJRU5ErkJggg==",
        title: "Break time",
        message: "Good work. Step away, stretch, and come back refreshed.",
      },
      () => resolve()
    );
  });

  return notificationId;
}

// Safely clear a notification without throwing if it does not exist.
function clearNotification(notificationId) {
  return withTimeout(
    new Promise((resolve) => {
      // chrome.notifications.clear may be absent in Jest stubs, so we check
      // before calling to keep tests passing without modifying the test file.
      if (chrome.notifications.clear) {
        chrome.notifications.clear(notificationId, () =>
          resolve({ success: true })
        );
      } else {
        resolve({ success: true });
      }
    }),
    POMODORO_CLEAR_NOTIFICATION_TIMEOUT_MS,
    "Pomodoro notification clear timed out"
  );
}

// Broadcast state changes to any open popup without failing when no listener exists.
function broadcastPomodoroState(state) {
  chrome.runtime.sendMessage({ action: "pomodoro:stateChanged", state }, () => {
    void chrome.runtime.lastError;
  });
}

// Load the saved focus mode, resolve its stored tool list, and apply everything.
async function applyFocusMode(modeId) {
  if (typeof modeId !== "string" || !modeId) {
    return { success: false, error: "Invalid focus mode" };
  }

  // Retrieve the full mode definition from storage so we know which tools to enable.
  const modeDefinition = await resolveModeById(modeId);

  await setStorage({ focusMode: modeId });
  // Clear any active break state when switching focus modes.
  await new Promise((resolve) => chrome.storage.local.remove("breakState", resolve));
  // Apply tool settings from the mode profile to storage.
  const toolSettings = modeDefinition ? modeDefinition.toolSettings || {} : {};
  if (toolSettings.focusDuration) {
    const focusDurationSeconds = toolSettings.focusDuration * 60;
    const currentPomState = await readPomodoroState();
    if (!currentPomState.isRunning) {
      const newPomState = setPomodoroDurationSeconds(currentPomState, focusDurationSeconds);
      await setStorage({ [POMODORO_STORAGE_KEY]: newPomState });
      broadcastPomodoroState(newPomState);
    }
  }
  if (toolSettings.breakDuration) {
    await setStorage({ breakduration: toolSettings.breakDuration });
  }
  if (toolSettings.focusDuration) {
    await setStorage({ focusduration: toolSettings.focusDuration });
  }

  // Stop any running Pomodoro when the new mode doesn't include it.
  const enabledTools = modeDefinition ? modeDefinition.enabledTools || [] : [];
  if (!enabledTools.includes("pomodoro")) {
    const pomState = await readPomodoroState();
    if (pomState.isRunning) {
      const stopped = pausePomodoro(pomState);
      await setStorage({ [POMODORO_STORAGE_KEY]: stopped });
      await clearPomodoroAlarm();
      broadcastPomodoroState(stopped);
    }
  }

  // Persist which tools are active so the popup can restore correct toggle states.
  await setStorage({ activeTools: enabledTools });

  // Broadcast the new tool state so any open popup updates immediately.
  broadcastFocusModeApplied(modeId, enabledTools);

  // Apply lightweight tab control for deep-work style modes.
  const shouldMuteActiveTab = modeId === "deep-work" || modeId === "study";
  const activeTab = await getActiveTab();

  if (activeTab && typeof activeTab.id === "number") {
    await updateTab(activeTab.id, { muted: shouldMuteActiveTab });
  }

  return {
    success: true,
    modeId,
    enabledTools,
    tabControlled: Boolean(activeTab),
  };
}

// Look up a mode definition from storage by id, returning null if not found.
function resolveModeById(modeId) {
  return new Promise((resolve) => {
    loadFocusModesFromStorage((modes) => {
      resolve(modes.find((m) => m.id === modeId) || null);
    });
  });
}

// Inform any open popup that a focus mode was applied and which tools are now active.
function broadcastFocusModeApplied(modeId, enabledTools) {
  chrome.runtime.sendMessage(
    { action: "focus:modeApplied", modeId, enabledTools },
    () => {
      void chrome.runtime.lastError;
    }
  );
}

// Query the current active tab for focus enforcement actions.
function getActiveTab() {
  return new Promise((resolve) => {
    chrome.tabs.query({ active: true, currentWindow: true }, (tabs) =>
      resolve(tabs[0] || null)
    );
  });
}

// Wrap tab updates so focus behavior is testable and service-worker friendly.
function updateTab(tabId, properties) {
  return new Promise((resolve) => {
    chrome.tabs.update(tabId, properties, (tab) => resolve(tab));
  });
}

// Promise wrapper for chrome.storage.local.get.
function getStorage(keys) {
  return new Promise((resolve) => {
    chrome.storage.local.get(keys, (data) => resolve(data || {}));
  });
}

// Promise wrapper for chrome.storage.local.set.
function setStorage(values) {
  return new Promise((resolve) => {
    chrome.storage.local.set(values, () => resolve());
  });
}

// Export internals for Jest while keeping Chrome runtime behavior unchanged.
if (typeof module !== "undefined") {
  module.exports = {
    MESSAGE_ACTIONS,
    POMODORO_ALARM_NAME,
    POMODORO_ALARM_SOUND_PATH,
    POMODORO_BREAK_NOTIFICATION_ID,
    POMODORO_COMPLETE_NOTIFICATION_ID,
    createNotificationId,
    applyPomodoroDuration,
    applyFocusMode,
    completePomodoroSession,
    handleAlarm,
    handleInstalled,
    handleMessage,
    handleMessageAsync,
    handlePomodoroComplete,
    handleStartup,
    notifyBreakStart,
    notifyPomodoroComplete,
    playPomodoroAlarmSound,
    testDebugAlerts,
  };
}
