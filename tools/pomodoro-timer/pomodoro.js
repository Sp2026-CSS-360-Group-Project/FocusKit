/* global FocusKitStorage */
// pomodoro.js - FocusKit Pomodoro timer state and popup UI.
// Load shared timer helpers from pomodoroState.js in Chrome and from require() in Jest.
const pomodoroStateHelpers =
  typeof FocusKitPomodoroState !== "undefined"
    ? FocusKitPomodoroState
    : require("./pomodoroState.js");

const {
  POMODORO_STORAGE_KEY,
  createBreakState,
  createInitialPomodoroState,
  formatPomodoroInput,
  parsePomodoroTimeInput,
  pausePomodoro,
  resetPomodoro,
  restorePomodoroState,
  setPomodoroDurationSeconds,
  startPomodoro,
  tickPomodoro,
} = pomodoroStateHelpers;

const POMODORO_EXTENSION_STREAK_STORAGE_KEY = "extensionStreak";

const BREAK_STORAGE_KEY = "breakState";

// Mutable popup session state; pure helpers below make this easy to test separately.
let pomodoroState = createInitialPomodoroState();
let pomodoroIntervalId = null;
let breakState = null;
let breakIntervalId = null;

// Swap the Tools list for the Pomodoro panel and hydrate saved timer state.
function openPomodoroPanel() {
  const toolsList = document.getElementById("toolsList");
  const panel = getPomodoroPanel();

  toolsList.hidden = true;
  panel.hidden = false;
  loadPomodoroState();
  loadPomodoroStats();
}

// Hide the Pomodoro panel and stop any active popup interval.
function closePomodoroPanel() {
  stopPomodoroInterval();
  document.getElementById("pomodoroPanel").hidden = true;
  document.getElementById("toolsList").hidden = false;
}

// Lazily create the panel because the Pomodoro tool is optional until launched.
function getPomodoroPanel() {
  let panel = document.getElementById("pomodoroPanel");

  if (panel) {
    return panel;
  }

  panel = document.createElement("div");
  panel.id = "pomodoroPanel";
  panel.className = "pomodoro-panel";
  panel.hidden = true;
  panel.innerHTML = `
    <div class="pomodoro-header">
      <div>
        <p class="section-label">POMODORO</p>
        <h2 class="pomodoro-title" id="pomodoroTitle">Focus Sprint</h2>
      </div>
      <span class="pomodoro-status" id="pomodoroStatus">Paused</span>
    </div>
    <div
      class="pomodoro-time"
      id="pomodoroTime"
      role="textbox"
      aria-label="Pomodoro timer"
      contenteditable="true"
      spellcheck="false"
      inputmode="numeric"
    >25:00</div>
    <div class="pomodoro-actions">
      <button class="pomodoro-button" type="button" id="pomodoroStart">Start</button>
      <button class="pomodoro-button" type="button" id="pomodoroPause">Pause</button>
      <button class="pomodoro-button" type="button" id="pomodoroReset">Reset</button>
      <button class="pomodoro-button" type="button" id="pomodoroStartBreak" hidden>Start Break</button>
      <button class="pomodoro-button secondary" type="button" id="pomodoroClose">Close</button>
    </div>
    <div class="pomodoro-stats">
      <div class="pomodoro-stat">
        <span class="pomodoro-stat-value" id="statToday">0</span>
        <span class="pomodoro-stat-label">Today</span>
      </div>
      <div class="pomodoro-stat">
        <span class="pomodoro-stat-value" id="statStreak">0</span>
        <span class="pomodoro-stat-label">Day streak</span>
      </div>
    </div>
  `;

  // Bind controls once when the panel is first created.
  document.getElementById("tab-tools").appendChild(panel);
  panel
    .querySelector("#pomodoroStart")
    .addEventListener("click", handlePomodoroStart);
  panel
    .querySelector("#pomodoroPause")
    .addEventListener("click", handlePomodoroPause);
  panel
    .querySelector("#pomodoroReset")
    .addEventListener("click", handlePomodoroReset);
  panel
    .querySelector("#pomodoroStartBreak")
    .addEventListener("click", handleStartBreak);
  panel
    .querySelector("#pomodoroTime")
    .addEventListener("blur", handlePomodoroTimeBlur);
  panel
    .querySelector("#pomodoroTime")
    .addEventListener("focus", handlePomodoroTimeFocus);
  panel
    .querySelector("#pomodoroTime")
    .addEventListener("keydown", handlePomodoroTimeKeydown);
  panel
    .querySelector("#pomodoroClose")
    .addEventListener("click", closePomodoroPanel);

  return panel;
}

// Start delegates timer ownership to the background service worker.
function handlePomodoroStart() {
  if (breakState) {
    breakState = { ...breakState, isRunning: true, lastUpdatedAt: Date.now() };
    renderBreak(breakState);
    startBreakInterval();
    chrome.storage.local.set({ [BREAK_STORAGE_KEY]: breakState });
    return;
  }

  applyPomodoroTimeInput();

  sendBackgroundMessage({ action: "pomodoro:start" }, (response) => {
    handlePomodoroResponse(response);
  });

  // Optimistic UI update: reflect running state immediately so the popup
  // doesn't appear out-of-sync while the background service worker wakes.
  try {
    pomodoroState = startPomodoro(pomodoroState);
    renderPomodoro(pomodoroState);
    startPomodoroInterval();
    persistPomodoroState(pomodoroState);
  } catch {
    // ignore
  }
}

// Pause asks the background service worker to account for elapsed time.
function handlePomodoroPause() {
  if (breakState) {
    breakState = pausePomodoro(breakState);
    renderBreak(breakState);
    if (breakIntervalId) {
      clearInterval(breakIntervalId);
      breakIntervalId = null;
    }
    chrome.storage.local.set({ [BREAK_STORAGE_KEY]: breakState });
    return;
  }
  // Optimistic UI update: pause immediately in the popup while background
  // commits pause in storage.
  try {
    pomodoroState = pausePomodoro(pomodoroState);
    renderPomodoro(pomodoroState);
    stopPomodoroInterval();
    persistPomodoroState(pomodoroState);
  } catch {
    // ignore
  }

  sendBackgroundMessage(
    { action: "pomodoro:pause", state: pomodoroState },
    (response) => {
      handlePomodoroResponse(response);
    }
  );
}

// Reset clears the background alarm and returns the UI to the default state.
function handlePomodoroReset() {
  if (breakState) {
    clearInterval(breakIntervalId);
    breakIntervalId = null;
    breakState = null;
    chrome.storage.local.remove(BREAK_STORAGE_KEY);
    hideBreakPrompt();
    renderPomodoro(pomodoroState);
    persistPomodoroState(pomodoroState);
    return;
  }
  hideBreakPrompt();
  sendBackgroundMessage({ action: "pomodoro:reset" }, (response) => {
    handlePomodoroResponse(response);
  });

  // Optimistic UI update: reset the popup immediately.
  try {
    pomodoroState = resetPomodoro(pomodoroState);
    renderPomodoro(pomodoroState);
    stopPomodoroInterval();
    persistPomodoroState(pomodoroState);
  } catch {
    // ignore
  }
}

// Apply editable timer text after blur.
function handlePomodoroTimeBlur() {
  applyPomodoroTimeInput();
}

// Show the start break button when a session completes.
function showBreakPrompt() {
  chrome.storage.local.get(["autobreak"], (data) => {
    if (data.autobreak) {
      handleStartBreak();
    } else {
      const btn = document.getElementById("pomodoroStartBreak");
      if (btn) btn.hidden = false;
    }
  });
}

// Hide the start break button.
function hideBreakPrompt() {
  const btn = document.getElementById("pomodoroStartBreak");
  if (btn) btn.hidden = true;
}

// Start the break timer using the saved break duration setting.
function handleStartBreak() {
  hideBreakPrompt();

  chrome.storage.local.get(["breakduration"], (data) => {
    const breakDurationSeconds = (data.breakduration || 5) * 60;
    breakState = createBreakState(breakDurationSeconds);
    // Don't start it yet — just show it
    renderBreak(breakState);
    chrome.storage.local.set({ [BREAK_STORAGE_KEY]: breakState });
  });
}

// Tick the break timer every second.
function startBreakInterval() {
  if (breakIntervalId) clearInterval(breakIntervalId);
  breakIntervalId = setInterval(() => {
    const now = Date.now();
    breakState = tickPomodoro(breakState, now);
    renderBreak(breakState);
    chrome.storage.local.set({ [BREAK_STORAGE_KEY]: breakState });

    if (!breakState.isRunning) {
      clearInterval(breakIntervalId);
      breakIntervalId = null;
      breakState = null;
      chrome.storage.local.remove(BREAK_STORAGE_KEY);
      pomodoroState = resetPomodoro(pomodoroState);
      renderPomodoro(pomodoroState);
      persistPomodoroState(pomodoroState);
    }
  }, 1000);
}

// Render the break timer in the existing timer display.
function renderBreak(state) {
  getPomodoroPanel();
  const timerDisplay = document.getElementById("pomodoroTime");
  timerDisplay.textContent = formatPomodoroInput(state.remainingSeconds);
  timerDisplay.contentEditable = String(!state.isRunning);
  document.getElementById("pomodoroStatus").textContent =
    state.isBreak && state.isRunning ? "Break" : "Break (Paused)";
  document.getElementById("pomodoroTitle").textContent = "Break Time";
}

// Make click-to-edit replace the whole timer value while paused.
function handlePomodoroTimeFocus(event) {
  if (pomodoroState.isRunning || (breakState && breakState.isRunning)) {
    event.currentTarget.blur();
    return;
  }

  const selection = window.getSelection();
  const range = document.createRange();
  range.selectNodeContents(event.currentTarget);
  selection.removeAllRanges();
  selection.addRange(range);
}

// Enter applies the typed timer value without inserting a newline.
function handlePomodoroTimeKeydown(event) {
  if (event.key === "Enter") {
    event.preventDefault();
    event.currentTarget.blur();
  }
}

// Let users choose the next paused Pomodoro duration by editing the timer text.
function applyPomodoroTimeInput() {
  if (breakState) {
    if (breakState.isRunning) {
      renderBreak(breakState);
      return;
    }
    const timerDisplay = document.getElementById("pomodoroTime");
    const durationSeconds = parsePomodoroTimeInput(timerDisplay.textContent);
    if (!durationSeconds) {
      renderBreak(breakState);
      return;
    }
    breakState = {
      ...breakState,
      remainingSeconds: durationSeconds,
      durationSeconds,
    };
    renderBreak(breakState);
    chrome.storage.local.set({ [BREAK_STORAGE_KEY]: breakState });
    return;
  }

  if (pomodoroState.isRunning) {
    renderPomodoro(pomodoroState);
    return;
  }

  const timerDisplay = document.getElementById("pomodoroTime");
  const durationSeconds = parsePomodoroTimeInput(timerDisplay.textContent);

  if (!durationSeconds) {
    renderPomodoro(pomodoroState);
    return;
  }

  sendBackgroundMessage(
    { action: "pomodoro:setDuration", seconds: durationSeconds },
    (response) => {
      if (response && response.success) {
        handlePomodoroResponse(response);
      } else {
        renderPomodoro(pomodoroState);
      }
    }
  );

  pomodoroState = setPomodoroDurationSeconds(pomodoroState, durationSeconds);
  renderPomodoro(pomodoroState);
  persistPomodoroState(pomodoroState);
}

// Refresh the visible popup display while the background alarm owns persistence.
function startPomodoroInterval() {
  stopPomodoroInterval();
  pomodoroIntervalId = setInterval(() => {
    const previousState = pomodoroState;
    const nextState = tickPomodoro(pomodoroState);

    pomodoroState = nextState;
    renderPomodoro(pomodoroState);

    if (!nextState.isRunning) {
      stopPomodoroInterval();
      if (previousState.isRunning && previousState.remainingSeconds > 0) {
        sendBackgroundMessage(
          { action: "pomodoro:complete", source: "popup" },
          (response) => {
            handlePomodoroResponse(response, { preserveCompleted: true });
          }
        );
        showBreakPrompt();
      }
      return;
    }

    persistPomodoroState(pomodoroState);
  }, 1000);
}

// Clear the active interval when the panel closes, pauses, resets, or completes.
function stopPomodoroInterval() {
  if (pomodoroIntervalId) {
    clearInterval(pomodoroIntervalId);
    pomodoroIntervalId = null;
  }
}

// Load current state from the background so reopened popups reflect elapsed time.
function loadPomodoroState() {
  chrome.storage.local.get(
    [POMODORO_STORAGE_KEY, BREAK_STORAGE_KEY],
    (data) => {
      if (data && data[BREAK_STORAGE_KEY]) {
        breakState = data[BREAK_STORAGE_KEY];
        renderBreak(breakState);
        if (breakState.isRunning) {
          startBreakInterval();
        }
        return;
      }
      if (data && data[POMODORO_STORAGE_KEY]) {
        handlePomodoroResponse({
          success: true,
          state: data[POMODORO_STORAGE_KEY],
        });
      }
    }
  );

  sendBackgroundMessage({ action: "pomodoro:getState" }, (response) => {
    if (breakState) return; // don't overwrite break UI
    handlePomodoroResponse(response);
  });
}

// Compute and display session stats from storage.
function loadPomodoroStats() {
  const storageHelpers =
    typeof FocusKitStorage !== "undefined"
      ? FocusKitStorage
      : require("../../storage.js");

  // Load today's session count from session history.
  storageHelpers.loadSessions().then((sessions) => {
    const now = new Date();
    const todayStart = new Date(
      now.getFullYear(),
      now.getMonth(),
      now.getDate()
    ).getTime();

    const todayCount = sessions.filter(
      (s) => s.completedAt >= todayStart
    ).length;

    document.getElementById("statToday").textContent = todayCount;
  });

  loadExtensionStreakStat();
}

function loadExtensionStreakStat() {
  chrome.storage.local.get([POMODORO_EXTENSION_STREAK_STORAGE_KEY], (data) => {
    renderExtensionStreakStat(data[POMODORO_EXTENSION_STREAK_STORAGE_KEY]);
  });
}

function renderExtensionStreakStat(streakState) {
  const stat = document.getElementById("statStreak");
  if (!stat || !streakState || !Number.isSafeInteger(streakState.count)) {
    return;
  }
  stat.textContent = String(streakState.count);
}

// Apply successful background timer responses to the popup state and display.
function handlePomodoroResponse(response, options = {}) {
  if (!response || !response.success || !response.state) {
    return;
  }

  pomodoroState = restorePomodoroState(response.state, Date.now(), options);
  renderPomodoro(pomodoroState);

  if (pomodoroState.isRunning) {
    startPomodoroInterval();
  } else {
    stopPomodoroInterval();
  }
}

// Send background commands through the MV3 message channel.
function sendBackgroundMessage(message, callback) {
  chrome.runtime.sendMessage(message, (response) => {
    callback(response);
  });
}

// Render the current timer value and running/paused label.
function renderPomodoro(state) {
  getPomodoroPanel();
  const timerDisplay = document.getElementById("pomodoroTime");
  timerDisplay.textContent = formatPomodoroInput(state.remainingSeconds);
  timerDisplay.contentEditable = String(!state.isRunning);
  document.getElementById("pomodoroStatus").textContent = state.isRunning
    ? "Running"
    : "Paused";
  document.getElementById("pomodoroTitle").textContent = "Focus Sprint";
}

// Keep storage aligned with the visible popup countdown so reopening restores it.
function persistPomodoroState(state) {
  chrome.storage.local.set({ [POMODORO_STORAGE_KEY]: state });
}

// Expose the launcher for tools.js in the browser runtime.
if (typeof window !== "undefined") {
  window.FocusKitPomodoro = {
    open: openPomodoroPanel,
  };

  chrome.runtime.onMessage.addListener((message) => {
    if (message && message.action === "pomodoro:stateChanged") {
      // Don't overwrite break UI with focus render
      if (message.state && message.state.isBreak && breakState) {
        return;
      }
      handlePomodoroResponse(
        { success: true, state: message.state },
        { preserveCompleted: true }
      );
    }
  });

  // Listen for direct storage changes as a robust fallback for UI sync when
  // the background service worker broadcasts state before the popup's
  // message handlers are available.
  if (chrome && chrome.storage && chrome.storage.onChanged) {
    chrome.storage.onChanged.addListener((changes, area) => {
      if (
        area === "local" &&
        changes.pomodoroState &&
        changes.pomodoroState.newValue
      ) {
        // Don't overwrite breakUI with focus render
        if (changes.pomodoroState.newValue.isBreak && breakState) {
          return;
        }
        handlePomodoroResponse(
          {
            success: true,
            state: changes.pomodoroState.newValue,
          },
          { preserveCompleted: true }
        );
      }
    });
  }
}

// Export pure timer helpers for Jest.
if (typeof module !== "undefined") {
  module.exports = pomodoroStateHelpers;
}
