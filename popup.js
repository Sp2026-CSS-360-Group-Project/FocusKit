// popup.js - handles tab navigation, registry rendering, and persisted settings.

// Shared streak helpers keep date math out of popup DOM wiring.
const streakHelpers =
  typeof globalThis !== "undefined" && globalThis.FocusKitStreakState
    ? globalThis.FocusKitStreakState
    : require("./tools/streak/streakState.js");

const {
  EXTENSION_STREAK_STORAGE_KEY,
  getEditableDailyStreakState,
  getNextDailyStreakState,
} = streakHelpers;

// Storage keys that mirror the Settings tab checkbox ids.
const SETTING_KEYS = ["notifications", "sound", "dark"];
const DEFAULT_DARK_MODE = true;

// Track the selected DOM card so only one focus mode appears active at a time.
const state = {
  selectedFocusCard: null,
};

// Initialize the popup once Chrome has loaded the extension document.
document.addEventListener("DOMContentLoaded", () => {
  setupTabs();
  renderTools();
  renderBuildWatermark();
  loadAndRenderFocusModes();
  setupExtensionStreak();
  loadSavedState();
  window.requestAnimationFrame(loadSavedState);
  setupSettingsPersistence();
  setupDebugAlerts();
  listenForBackgroundMessages();
});

// Wire the top navigation buttons to their matching tab panels.
function setupTabs() {
  const buttons = document.querySelectorAll(".tab-btn");
  const panels = document.querySelectorAll(".tab-panel");

  buttons.forEach((button) => {
    button.addEventListener("click", () => {
      buttons.forEach((currentButton) =>
        currentButton.classList.remove("active")
      );
      panels.forEach((panel) => panel.classList.remove("active"));

      button.classList.add("active");
      document
        .getElementById(`tab-${button.dataset.tab}`)
        .classList.add("active");

      if (button.dataset.tab === "settings") {
        loadSavedState();
        loadExtensionStreak();
      }
    });
  });
}

// Render tool cards from the registry in tools.js so smoke tests and UI share one source.
function renderTools() {
  const container = document.getElementById("toolsList");
  container.replaceChildren();

  window.TOOLS.forEach((tool) => {
    const card = document.createElement("div");
    card.className = "tool-card";

    const toolInfo = document.createElement("div");
    toolInfo.className = "tool-info";

    const icon = document.createElement("span");
    icon.className = "tool-icon";
    icon.textContent = tool.icon;

    const textWrap = document.createElement("div");
    textWrap.className = "tool-copy";

    const name = document.createElement("span");
    name.className = "tool-name";
    name.textContent = tool.name;

    const desc = document.createElement("span");
    desc.className = "tool-desc";
    desc.textContent = tool.desc;

    const launchButton = document.createElement("button");
    launchButton.className = "tool-launch";
    launchButton.type = "button";
    launchButton.dataset.id = tool.id;
    launchButton.setAttribute("aria-label", `Launch ${tool.name}`);
    launchButton.textContent = "Launch";
    launchButton.addEventListener("click", () => tool.launch(launchButton));

    textWrap.append(name, desc);
    toolInfo.append(icon, textWrap);
    card.append(toolInfo, launchButton);
    container.appendChild(card);
  });
}

// Show the generated commit marker so testers can confirm Chrome loaded this build.
function renderBuildWatermark() {
  const watermark = document.getElementById("buildWatermark");

  if (!watermark) {
    return;
  }

  const commit =
    typeof globalThis !== "undefined" &&
    globalThis.FocusKitBuildInfo &&
    typeof globalThis.FocusKitBuildInfo.commit === "string"
      ? globalThis.FocusKitBuildInfo.commit
      : "dev";

  watermark.textContent = `build: ${commit}`;
}

// ---------------------------------------------------------------------------
// Focus mode rendering
// ---------------------------------------------------------------------------

// Load modes from storage then build the full Focus tab UI.
function loadAndRenderFocusModes() {
  window.FocusKitModes.loadFocusModes((modes) => {
    renderFocusModes(modes);
  });
}

// Build the Focus tab: selectable mode cards + a "New mode" button.
function renderFocusModes(modes) {
  const container = document.getElementById("focusModes");
  container.replaceChildren();

  modes.forEach((mode) => {
    container.appendChild(buildModeCard(mode));
  });

  // "New mode" button sits at the bottom of the list.
  const addButton = document.createElement("button");
  addButton.className = "focus-add-btn";
  addButton.type = "button";
  addButton.textContent = "+ New mode";
  addButton.addEventListener("click", () => openModeForm(null));
  container.appendChild(addButton);

  // Re-apply the saved selection highlight after a re-render.
  chrome.storage.local.get(["focusMode"], (data) => {
    if (data.focusMode) {
      const savedCard = container.querySelector(
        `[data-mode-id="${data.focusMode}"]`
      );
      if (savedCard) selectFocusMode(data.focusMode, savedCard, false);
    }
  });
}

// Build a single selectable mode card with optional Edit / Delete controls.
function buildModeCard(mode) {
  const card = document.createElement("button");
  card.className = "focus-card";
  card.type = "button";
  card.dataset.modeId = mode.id;

  const header = document.createElement("div");
  header.className = "focus-header";

  const icon = document.createElement("span");
  icon.className = "focus-icon";
  icon.textContent = mode.icon;

  const name = document.createElement("span");
  name.className = "focus-name";
  name.textContent = mode.name;

  const desc = document.createElement("p");
  desc.className = "focus-desc";
  desc.textContent = mode.desc;

  header.append(icon, name);

  // Custom modes get Edit and Delete buttons; built-ins only get Edit.
  const actions = document.createElement("div");
  actions.className = "focus-card-actions";

  const editBtn = document.createElement("button");
  editBtn.className = "focus-action-btn";
  editBtn.type = "button";
  editBtn.textContent = "Edit";
  editBtn.setAttribute("aria-label", `Edit ${mode.name}`);
  editBtn.addEventListener("click", (event) => {
    event.stopPropagation();
    openModeForm(mode);
  });
  actions.appendChild(editBtn);

  if (!mode.builtIn) {
    const deleteBtn = document.createElement("button");
    deleteBtn.className = "focus-action-btn focus-action-btn--danger";
    deleteBtn.type = "button";
    deleteBtn.textContent = "Delete";
    deleteBtn.setAttribute("aria-label", `Delete ${mode.name}`);
    deleteBtn.addEventListener("click", (event) => {
      event.stopPropagation();
      confirmDeleteMode(mode);
    });
    actions.appendChild(deleteBtn);
  }

  card.append(header, desc, actions);
  card.addEventListener("click", () => selectFocusMode(mode.id, card, true));

  return card;
}

// ---------------------------------------------------------------------------
// Create / Edit form (inline overlay within the focus tab panel)
// ---------------------------------------------------------------------------

// Open the create/edit form. Pass null for mode to create a new one.
function openModeForm(existingMode) {
  // Remove any existing form first.
  const existing = document.getElementById("focusModeForm");
  if (existing) existing.remove();

  const allToolIds = (window.TOOLS || []).map((t) => t.id);
  const currentEnabled = existingMode ? existingMode.enabledTools || [] : [];

  const overlay = document.createElement("div");
  overlay.id = "focusModeForm";
  overlay.className = "focus-form-overlay";
  overlay.setAttribute("role", "dialog");
  overlay.setAttribute("aria-modal", "true");
  overlay.setAttribute(
    "aria-label",
    existingMode ? "Edit focus mode" : "New focus mode"
  );

  const form = document.createElement("div");
  form.className = "focus-form";

  // Title row
  const titleRow = document.createElement("div");
  titleRow.className = "focus-form-title";
  titleRow.textContent = existingMode ? "Edit mode" : "New mode";

  // Name field
  const nameLabel = document.createElement("label");
  nameLabel.className = "focus-form-label";
  nameLabel.textContent = "Name";
  const nameInput = document.createElement("input");
  nameInput.className = "focus-form-input";
  nameInput.type = "text";
  nameInput.maxLength = 40;
  nameInput.placeholder = "e.g. Deep Writing";
  nameInput.value = existingMode ? existingMode.name : "";
  nameInput.setAttribute("aria-label", "Mode name");

  // Description field
  const descLabel = document.createElement("label");
  descLabel.className = "focus-form-label";
  descLabel.textContent = "Description";
  const descInput = document.createElement("input");
  descInput.className = "focus-form-input";
  descInput.type = "text";
  descInput.maxLength = 80;
  descInput.placeholder = "Short description of this mode";
  descInput.value = existingMode ? existingMode.desc : "";
  descInput.setAttribute("aria-label", "Mode description");

  // Tools checkboxes
  const toolsLabel = document.createElement("div");
  toolsLabel.className = "focus-form-label";
  toolsLabel.textContent = "Enabled tools";

  const toolsGroup = document.createElement("div");
  toolsGroup.className = "focus-form-tools";

  allToolIds.forEach((toolId) => {
    const toolDef = (window.TOOLS || []).find((t) => t.id === toolId);
    const row = document.createElement("label");
    row.className = "focus-form-tool-row";
    const checkbox = document.createElement("input");
    checkbox.type = "checkbox";
    checkbox.value = toolId;
    checkbox.checked = currentEnabled.includes(toolId);
    const toolName = document.createElement("span");
    toolName.textContent = toolDef ? toolDef.name : toolId;
    row.append(checkbox, toolName);
    toolsGroup.appendChild(row);
  });

  // Error message area (hidden until validation fails).
  const errorMsg = document.createElement("p");
  errorMsg.className = "focus-form-error";
  errorMsg.setAttribute("role", "alert");
  errorMsg.setAttribute("aria-live", "polite");
  errorMsg.hidden = true;

  // Button row
  const buttonRow = document.createElement("div");
  buttonRow.className = "focus-form-buttons";

  const saveBtn = document.createElement("button");
  saveBtn.className = "focus-form-save";
  saveBtn.type = "button";
  saveBtn.textContent = "Save";

  const cancelBtn = document.createElement("button");
  cancelBtn.className = "focus-form-cancel";
  cancelBtn.type = "button";
  cancelBtn.textContent = "Cancel";
  cancelBtn.addEventListener("click", () => overlay.remove());

  saveBtn.addEventListener("click", () => {
    const trimmedName = nameInput.value.trim();
    if (!trimmedName) {
      errorMsg.textContent = "Name is required.";
      errorMsg.hidden = false;
      nameInput.focus();
      return;
    }
    errorMsg.hidden = true;

    const enabledTools = Array.from(
      toolsGroup.querySelectorAll("input[type=checkbox]")
    )
      .filter((cb) => cb.checked)
      .map((cb) => cb.value);

    if (existingMode) {
      window.FocusKitModes.updateFocusMode(
        existingMode.id,
        { name: trimmedName, desc: descInput.value.trim(), enabledTools },
        () => {
          overlay.remove();
          loadAndRenderFocusModes();
        }
      );
    } else {
      window.FocusKitModes.createFocusMode(
        trimmedName,
        descInput.value.trim(),
        enabledTools,
        {},
        () => {
          overlay.remove();
          loadAndRenderFocusModes();
        }
      );
    }
  });

  buttonRow.append(saveBtn, cancelBtn);
  form.append(
    titleRow,
    nameLabel,
    nameInput,
    descLabel,
    descInput,
    toolsLabel,
    toolsGroup,
    errorMsg,
    buttonRow
  );
  overlay.appendChild(form);

  document.getElementById("tab-focus").appendChild(overlay);
  nameInput.focus();
}

// Ask for confirmation then delete. Simple inline confirm to stay inside the popup.
function confirmDeleteMode(mode) {
  const existing = document.getElementById("focusDeleteConfirm");
  if (existing) existing.remove();

  const overlay = document.createElement("div");
  overlay.id = "focusDeleteConfirm";
  overlay.className = "focus-form-overlay";
  overlay.setAttribute("role", "dialog");
  overlay.setAttribute("aria-modal", "true");

  const box = document.createElement("div");
  box.className = "focus-form focus-confirm";

  const msg = document.createElement("p");
  msg.className = "focus-confirm-msg";
  msg.textContent = `Delete "${mode.name}"? This cannot be undone.`;

  const buttonRow = document.createElement("div");
  buttonRow.className = "focus-form-buttons";

  const confirmBtn = document.createElement("button");
  confirmBtn.className = "focus-form-save focus-form-save--danger";
  confirmBtn.type = "button";
  confirmBtn.textContent = "Delete";
  confirmBtn.addEventListener("click", () => {
    window.FocusKitModes.deleteFocusMode(mode.id, () => {
      overlay.remove();
      loadAndRenderFocusModes();
    });
  });

  const cancelBtn = document.createElement("button");
  cancelBtn.className = "focus-form-cancel";
  cancelBtn.type = "button";
  cancelBtn.textContent = "Cancel";
  cancelBtn.addEventListener("click", () => overlay.remove());

  buttonRow.append(confirmBtn, cancelBtn);
  box.append(msg, buttonRow);
  overlay.appendChild(box);
  document.getElementById("tab-focus").appendChild(overlay);
  confirmBtn.focus();
}

// ---------------------------------------------------------------------------
// Settings and persistence
// ---------------------------------------------------------------------------

// Restore checkbox values, theme, and the selected focus mode from chrome.storage.
function loadSavedState() {
  chrome.storage.local.get([...SETTING_KEYS, "focusMode"], (data) => {
    const isDarkMode = resolveDarkMode(data.dark);

    applyTheme(isDarkMode);

    SETTING_KEYS.forEach((key) => {
      const input = document.getElementById(`setting${capitalize(key)}`);

      if (input && data[key] !== undefined) {
        input.checked = data[key];
      }
    });

    document.getElementById("settingDark").checked = isDarkMode;

    if (data.focusMode) {
      const savedCard = document.querySelector(
        `[data-mode-id="${data.focusMode}"]`
      );

      if (savedCard) {
        selectFocusMode(data.focusMode, savedCard, false);
      }
    }
  });
}

// Persist settings as soon as users toggle them, applying theme changes immediately.
function setupSettingsPersistence() {
  document
    .querySelectorAll(".settings-list input[type=checkbox]")
    .forEach((input) => {
      input.addEventListener("change", () => {
        const key = settingKeyFromInput(input);

        if (key === "dark") {
          applyTheme(input.checked);
        }

        chrome.storage.local.set({ [key]: input.checked });
      });
    });
}

// Record a popup open as today's extension use, then render the Settings count.
function setupExtensionStreak() {
  recordExtensionUse();
  setupExtensionStreakEditor();
}

// Load the saved streak without changing it, useful when the Settings tab reopens.
function loadExtensionStreak() {
  chrome.storage.local.get([EXTENSION_STREAK_STORAGE_KEY], (data) => {
    renderExtensionStreak(data[EXTENSION_STREAK_STORAGE_KEY]);
  });
}

// Update stored streak state according to local calendar-day usage.
function recordExtensionUse(now = Date.now()) {
  chrome.storage.local.get([EXTENSION_STREAK_STORAGE_KEY], (data) => {
    const nextState = getNextDailyStreakState(
      data[EXTENSION_STREAK_STORAGE_KEY],
      now
    );

    chrome.storage.local.set(
      { [EXTENSION_STREAK_STORAGE_KEY]: nextState },
      () => renderExtensionStreak(nextState)
    );
  });
}

// Wire the editable Settings input to validated streak-state persistence.
function setupExtensionStreakEditor() {
  const input = document.getElementById("settingStreak");
  const saveButton = document.getElementById("settingStreakSave");

  if (!input || !saveButton) {
    return;
  }

  saveButton.addEventListener("click", saveEditableExtensionStreak);
  input.addEventListener("keydown", (event) => {
    if (event.key === "Enter") {
      event.preventDefault();
      saveEditableExtensionStreak();
    }
  });
}

// Save a user-entered streak count and anchor it to today's local day.
function saveEditableExtensionStreak() {
  const input = document.getElementById("settingStreak");
  const status = document.getElementById("settingStreakStatus");
  const nextState = getEditableDailyStreakState(input.value);

  if (!nextState) {
    status.textContent = "Use a whole number of days.";
    input.setAttribute("aria-invalid", "true");
    return;
  }

  input.setAttribute("aria-invalid", "false");
  chrome.storage.local.set(
    { [EXTENSION_STREAK_STORAGE_KEY]: nextState },
    () => {
      renderExtensionStreak(nextState);
      status.textContent = "Saved.";
    }
  );
}

// Reflect current extension-open streak state everywhere it is visible.
function renderExtensionStreak(streakState) {
  const input = document.getElementById("settingStreak");
  const visibleCount = document.getElementById("extensionStreak");
  const currentCount = document.getElementById("settingStreakCurrent");

  if (!streakState || !Number.isSafeInteger(streakState.count)) {
    return;
  }

  const dayLabel = streakState.count === 1 ? "day" : "days";
  const visibleText = `Streak: ${streakState.count} ${dayLabel}`;
  const settingsText = `Current streak: ${streakState.count} ${dayLabel}`;

  if (visibleCount) {
    visibleCount.textContent = visibleText;
  }

  if (currentCount) {
    currentCount.textContent = settingsText;
  }

  if (input) {
    input.value = String(streakState.count);
  }
}

// Temporary debug control for manually verifying notification and sound APIs.
function setupDebugAlerts() {
  const button = document.getElementById("debugAlertsBtn");
  const result = document.getElementById("debugAlertsResult");

  if (!button || !result) {
    return;
  }

  button.addEventListener("click", () => {
    result.textContent = "Requesting test alert...";

    chrome.runtime.sendMessage({ action: "debug:testAlerts" }, (response) => {
      console.log("Debug alert result", response);

      if (!response || !Array.isArray(response.errors)) {
        result.textContent = "Test alert failed: No structured response";
        return;
      }

      if (response.errors.length > 0) {
        result.textContent = `Test alert failed: ${response.errors.join("; ")}`;
        return;
      }

      result.textContent = "Test alert requested.";
    });
  });
}

// Keep the popup in sync when the background applies a mode while the popup is open.
function listenForBackgroundMessages() {
  chrome.runtime.onMessage.addListener((message) => {
    if (message.action === "focus:modeApplied") {
      const card = document.querySelector(`[data-mode-id="${message.modeId}"]`);
      if (card) selectFocusMode(message.modeId, card, false);
    }
  });
}

// Apply theme classes to both roots used by the popup CSS.
function applyTheme(isDarkMode) {
  document.querySelectorAll("body, .app").forEach((themeRoot) => {
    themeRoot.classList.toggle("theme-dark", isDarkMode);
    themeRoot.classList.toggle("theme-light", !isDarkMode);
  });
}

// Default to dark mode until the user explicitly saves another preference.
function resolveDarkMode(savedValue) {
  return savedValue !== undefined ? savedValue : DEFAULT_DARK_MODE;
}

// Update visual selection state and optionally persist the chosen focus mode.
function selectFocusMode(modeId, card, shouldPersist) {
  if (state.selectedFocusCard) {
    state.selectedFocusCard.classList.remove("selected");
  }

  card.classList.add("selected");
  state.selectedFocusCard = card;

  const statusDot = document.getElementById("statusDot");
  statusDot.classList.add("active");
  statusDot.setAttribute("aria-label", `Focus mode active: ${modeId}`);

  if (shouldPersist) {
    chrome.storage.local.set({ focusMode: modeId });
    chrome.runtime.sendMessage({ action: "focus:setMode", modeId });
  }
}

// Translate ids like settingNotifications into chrome.storage keys.
function settingKeyFromInput(input) {
  return input.id.replace("setting", "").toLowerCase();
}

// Small formatting helper for deriving checkbox ids from storage keys.
function capitalize(value) {
  return `${value.charAt(0).toUpperCase()}${value.slice(1)}`;
}

// Export pure helpers for Jest while leaving the popup globals untouched in Chrome.
if (typeof module !== "undefined") {
  module.exports = {
    settingKeyFromInput,
    capitalize,
    applyTheme,
    resolveDarkMode,
    renderBuildWatermark,
  };
}
