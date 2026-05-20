// background.js - MV3 service worker for timers, notifications, tabs, and popup messages.

// Load shared Pomodoro state helpers when running as a Chrome service worker.
if (
  typeof importScripts === "function" &&
  typeof FocusKitPomodoroState === "undefined"
) {
  importScripts("../tools/pomodor-timer/pomodoroState.js");
  importScripts("../tools/focus-modes/focusModes.js");
}

// Reuse shared state helpers in Jest without duplicating timer rules in the worker.
const pomodoroHelpers =
  typeof FocusKitPomodoroState !== "undefined"
    ? FocusKitPomodoroState
    : require("../tools/pomodor-timer/pomodoroState.js");

const focusModeHelpers =
  typeof FocusKitModes !== "undefined"
    ? FocusKitModes
    : require("../tools/focus-modes/focusModes.js");

// Keep background command names centralized so popup and tests use one message surface.
const POMODORO_ALARM_NAME = "focuskit:pomodoro";
const POMODORO_COMPLETE_NOTIFICATION_ID = "focuskit-pomodoro-complete";
// Separate id prevents the break notification overwriting the complete notification.
const POMODORO_BREAK_NOTIFICATION_ID = "focuskit-pomodoro-break";

const MESSAGE_ACTIONS = {
  ping: "ping",
  pomodoroGetState: "pomodoro:getState",
  pomodoroStart: "pomodoro:start",
  pomodoroPause: "pomodoro:pause",
  pomodoroReset: "pomodoro:reset",
  focusSetMode: "focus:setMode",
};

const {
  POMODORO_STORAGE_KEY,
  pausePomodoro,
  resetPomodoro,
  restorePomodoroState,
  startPomodoro,
  tickPomodoro,
} = pomodoroHelpers;

const { loadFocusModes, FOCUS_MODES_STORAGE_KEY } = focusModeHelpers;

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

  handleMessageAsync(message)
    .then(sendResponse)
    .catch((error) =>
      sendResponse({
        success: false,
        error: error.message || "Background request failed",
      }),
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
      state: await updatePomodoroState(pausePomodoro, false),
    };
  }

  if (message.action === MESSAGE_ACTIONS.pomodoroReset) {
    const state = resetPomodoro();
    await setStorage({ [POMODORO_STORAGE_KEY]: state });
    await clearPomodoroAlarm();
    broadcastPomodoroState(state);

    return { success: true, state };
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
  await setStorage({ [POMODORO_STORAGE_KEY]: nextState });
  broadcastPomodoroState(nextState);

  if (!nextState.isRunning) {
    await clearPomodoroAlarm();

    if (previousState.isRunning && previousState.remainingSeconds > 0) {
      // Notify for session end. Then check if a break phase is starting.
      await notifyPomodoroComplete();

      // If pomodoroState transitions into a break after completion, notify break start.
      // A break phase is indicated when the next cycle sets isBreak = true.
      if (nextState.isBreak) {
        await notifyBreakStart();
      }
    }
  }
}

// Read, normalize, persist, and return the current timer state.
async function getCurrentPomodoroState() {
  const state = await readPomodoroState();
  await setStorage({ [POMODORO_STORAGE_KEY]: state });
  await syncPomodoroAlarm(state);

  return state;
}

// Apply a timer transition, persist it, update alarms, and inform open popup views.
async function updatePomodoroState(transition, shouldRunAlarm) {
  const previousState = await readPomodoroState();
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
async function readPomodoroState() {
  const data = await getStorage([POMODORO_STORAGE_KEY]);

  return restorePomodoroState(data[POMODORO_STORAGE_KEY]);
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
      resolve(),
    );
  });
}

// Clear timer alarms whenever the timer pauses, resets, or completes.
function clearPomodoroAlarm() {
  return new Promise((resolve) => {
    chrome.alarms.clear(POMODORO_ALARM_NAME, () => resolve());
  });
}

// Notify the user when a focus sprint ends. Skipped if notifications are disabled.
async function notifyPomodoroComplete() {
  const settings = await getStorage(["notifications"]);

  if (settings.notifications === false) {
    return;
  }

  // Clear any stale break notification before showing the complete one.
  await clearNotification(POMODORO_BREAK_NOTIFICATION_ID);

  await new Promise((resolve) => {
    chrome.notifications.create(
      POMODORO_COMPLETE_NOTIFICATION_ID,
      {
        type: "basic",
        iconUrl:
          typeof chrome.runtime.getURL === "function"
            ? chrome.runtime.getURL("icons/icon48.png")
            : "icons/icon48.png",
        title: "Focus sprint complete",
        message:
          "Your Pomodoro is done. Take a short reset before the next block.",
      },
      () => resolve(),
    );
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

  await new Promise((resolve) => {
    chrome.notifications.create(
      POMODORO_BREAK_NOTIFICATION_ID,
      {
        type: "basic",
        iconUrl:
          "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAEAAAABACAQAAAAAYLlVAAAAW0lEQVR42u3QMQEAAAgDIN8/9K3hCGQKUpmZAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAtwY/QgAB2ndzLAAAAABJRU5ErkJggg==",
        title: "Break time",
        message: "Good work. Step away, stretch, and come back refreshed.",
      },
      () => resolve(),
    );
  });
}

// Safely clear a notification without throwing if it does not exist.
function clearNotification(notificationId) {
  return new Promise((resolve) => {
    // chrome.notifications.clear may be absent in Jest stubs, so we check
    // before calling to keep tests passing without modifying the test file.
    if (chrome.notifications.clear) {
      chrome.notifications.clear(notificationId, () => resolve());
    } else {
      resolve();
    }
  });
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
    loadFocusModes((modes) => {
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
    },
  );
}

// Query the current active tab for focus enforcement actions.
function getActiveTab() {
  return new Promise((resolve) => {
    chrome.tabs.query({ active: true, currentWindow: true }, (tabs) =>
      resolve(tabs[0] || null),
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
    POMODORO_BREAK_NOTIFICATION_ID,
    POMODORO_COMPLETE_NOTIFICATION_ID,
    applyFocusMode,
    handleAlarm,
    handleInstalled,
    handleMessage,
    handleMessageAsync,
    handleStartup,
    notifyBreakStart,
    notifyPomodoroComplete,
  };
}
