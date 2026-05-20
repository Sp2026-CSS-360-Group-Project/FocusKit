// pomodoro.js - FocusKit Pomodoro timer state and popup UI.

// Load shared timer helpers from pomodoroState.js in Chrome and from require() in Jest.
const pomodoroStateHelpers =
  typeof FocusKitPomodoroState !== "undefined"
    ? FocusKitPomodoroState
    : require("./pomodoroState.js");

const {
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
} = pomodoroStateHelpers;

// Mutable popup session state; pure helpers below make this easy to test separately.
let pomodoroState = createInitialPomodoroState();
let pomodoroIntervalId = null;

// Swap the Tools list for the Pomodoro panel and hydrate saved timer state.
function openPomodoroPanel() {
  const toolsList = document.getElementById("toolsList");
  const panel = getPomodoroPanel();

  toolsList.hidden = true;
  panel.hidden = false;
  loadPomodoroState();
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
        <h2 class="pomodoro-title">Focus Sprint</h2>
      </div>
      <span class="pomodoro-status" id="pomodoroStatus">Paused</span>
    </div>
    <div class="pomodoro-time" id="pomodoroTime">25:00</div>
    <label class="pomodoro-duration" for="pomodoroDuration">
      <span>Duration minutes:</span>
      <input
        id="pomodoroDuration"
        type="number"
        min="1"
        max="${POMODORO_MAX_DURATION_MINUTES}"
        step="1"
        value="25"
        aria-label="Duration minutes"
      />
    </label>
    <div class="pomodoro-actions">
      <button class="pomodoro-button" type="button" id="pomodoroStart">Start</button>
      <button class="pomodoro-button" type="button" id="pomodoroPause">Pause</button>
      <button class="pomodoro-button" type="button" id="pomodoroReset">Reset</button>
      <button class="pomodoro-button secondary" type="button" id="pomodoroClose">Close</button>
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
    .querySelector("#pomodoroDuration")
    .addEventListener("change", handlePomodoroDurationChange);
  panel
    .querySelector("#pomodoroDuration")
    .addEventListener("keydown", handlePomodoroDurationKeydown);
  panel
    .querySelector("#pomodoroClose")
    .addEventListener("click", closePomodoroPanel);

  return panel;
}

// Start delegates timer ownership to the background service worker.
function handlePomodoroStart() {
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
  } catch (e) {
    // ignore
  }
}

// Pause asks the background service worker to account for elapsed time.
function handlePomodoroPause() {
  // Optimistic UI update: pause immediately in the popup while background
  // commits pause in storage.
  try {
    pomodoroState = pausePomodoro(pomodoroState);
    renderPomodoro(pomodoroState);
    stopPomodoroInterval();
    persistPomodoroState(pomodoroState);
  } catch (e) {
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
  sendBackgroundMessage({ action: "pomodoro:reset" }, (response) => {
    handlePomodoroResponse(response);
  });

  // Optimistic UI update: reset the popup immediately.
  try {
    pomodoroState = resetPomodoro(pomodoroState);
    renderPomodoro(pomodoroState);
    stopPomodoroInterval();
    persistPomodoroState(pomodoroState);
  } catch (e) {
    // ignore
  }
}

// Let users choose the next paused Pomodoro duration directly in the tool.
function handlePomodoroDurationChange(event) {
  if (pomodoroState.isRunning) {
    renderPomodoro(pomodoroState);
    return;
  }

  const durationMinutes = normalizePomodoroDurationMinutes(event.target.value);

  if (!durationMinutes) {
    renderPomodoro(pomodoroState);
    return;
  }

  sendBackgroundMessage(
    { action: "pomodoro:setDuration", minutes: durationMinutes },
    (response) => {
      if (response && response.success) {
        handlePomodoroResponse(response);
      } else {
        renderPomodoro(pomodoroState);
      }
    }
  );

  pomodoroState = setPomodoroDuration(pomodoroState, durationMinutes);
  renderPomodoro(pomodoroState);
}

// Pressing Enter applies the typed duration without requiring a blur first.
function handlePomodoroDurationKeydown(event) {
  if (event.key === "Enter") {
    event.preventDefault();
    handlePomodoroDurationChange(event);
  }
}

// Refresh the visible popup display while the background alarm owns persistence.
function startPomodoroInterval() {
  stopPomodoroInterval();
  pomodoroIntervalId = setInterval(() => {
    pomodoroState = tickPomodoro(pomodoroState);
    renderPomodoro(pomodoroState);
    persistPomodoroState(pomodoroState);

    if (!pomodoroState.isRunning) {
      stopPomodoroInterval();
    }
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
  chrome.storage.local.get([POMODORO_STORAGE_KEY], (data) => {
    if (data && data[POMODORO_STORAGE_KEY]) {
      handlePomodoroResponse({
        success: true,
        state: data[POMODORO_STORAGE_KEY],
      });
    }
  });

  sendBackgroundMessage({ action: "pomodoro:getState" }, (response) => {
    handlePomodoroResponse(response);
  });
}

// Apply successful background timer responses to the popup state and display.
function handlePomodoroResponse(response) {
  if (!response || !response.success || !response.state) {
    return;
  }

  pomodoroState = restorePomodoroState(response.state);
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
  document.getElementById("pomodoroTime").textContent = formatTime(
    state.remainingSeconds
  );
  document.getElementById("pomodoroStatus").textContent = state.isRunning
    ? "Running"
    : "Paused";
  const durationInput = document.getElementById("pomodoroDuration");
  durationInput.value = String(state.durationMinutes || 25);
  durationInput.disabled = state.isRunning;
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
      handlePomodoroResponse({ success: true, state: message.state });
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
        handlePomodoroResponse({
          success: true,
          state: changes.pomodoroState.newValue,
        });
      }
    });
  }
}

// Export pure timer helpers for Jest.
if (typeof module !== "undefined") {
  module.exports = pomodoroStateHelpers;
}
