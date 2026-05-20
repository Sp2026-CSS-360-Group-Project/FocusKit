// focusModes.js - CRUD operations and storage for user-created focus modes.

// Storage key used by both this module and background.js.
const FOCUS_MODES_STORAGE_KEY = "focusKit:focusModes";
const ACTIVE_MODE_STORAGE_KEY = "focusMode";

// Built-in modes that ship with the extension. Users cannot delete these.
const DEFAULT_FOCUS_MODES = [
  {
    id: "deep-work",
    name: "Deep Work",
    icon: "D",
    desc: "Long, distraction-light sessions for complex work.",
    builtIn: true,
    enabledTools: ["pomodoro"],
    toolSettings: {},
  },
  {
    id: "study",
    name: "Study",
    icon: "S",
    desc: "Structured review mode for notes, reading, and practice.",
    builtIn: true,
    enabledTools: ["pomodoro", "eisenhower"],
    toolSettings: {},
  },
  {
    id: "break",
    name: "Lazy",
    icon: "L",
    desc: "Doomscrolling Time!",
    builtIn: true,
    enabledTools: [],
    toolSettings: {},
  },
];

// Load all focus modes from storage, falling back to defaults when storage is empty.
function loadFocusModes(callback) {
  chrome.storage.local.get([FOCUS_MODES_STORAGE_KEY], (data) => {
    const stored = data[FOCUS_MODES_STORAGE_KEY];
    // First run: seed storage with defaults so future saves merge correctly.
    if (!Array.isArray(stored)) {
      chrome.storage.local.set(
        { [FOCUS_MODES_STORAGE_KEY]: DEFAULT_FOCUS_MODES },
        () => {
          callback(DEFAULT_FOCUS_MODES);
        }
      );
    } else {
      callback(stored);
    }
  });
}

// Persist the full modes array, then call back with the saved list.
function saveFocusModes(modes, callback) {
  chrome.storage.local.set({ [FOCUS_MODES_STORAGE_KEY]: modes }, () => {
    if (callback) callback(modes);
  });
}

// Add a new user-created mode. Generates a unique id from the name + timestamp.
function createFocusMode(name, desc, enabledTools, toolSettings, callback) {
  const newMode = {
    id: "custom-" + Date.now(),
    name: name.trim(),
    icon: name.trim().charAt(0).toUpperCase(),
    desc: desc.trim(),
    builtIn: false,
    enabledTools: enabledTools || [],
    toolSettings: toolSettings || {},
  };

  loadFocusModes((modes) => {
    const updated = [...modes, newMode];
    saveFocusModes(updated, () => callback(newMode, updated));
  });
}

// Replace the fields of an existing mode by id. Built-in modes can be updated too.
function updateFocusMode(modeId, changes, callback) {
  loadFocusModes((modes) => {
    const updated = modes.map((mode) => {
      if (mode.id !== modeId) return mode;
      return {
        ...mode,
        ...changes,
        // Keep id and builtIn flag immutable.
        id: mode.id,
        builtIn: mode.builtIn,
      };
    });
    saveFocusModes(updated, () => callback(updated));
  });
}

// Remove a user-created mode. Refuses to delete built-in modes.
function deleteFocusMode(modeId, callback) {
  loadFocusModes((modes) => {
    const target = modes.find((m) => m.id === modeId);
    if (!target || target.builtIn) {
      if (callback) callback(false, modes);
      return;
    }
    const updated = modes.filter((m) => m.id !== modeId);
    // If the deleted mode was active, clear that selection too.
    chrome.storage.local.get([ACTIVE_MODE_STORAGE_KEY], (data) => {
      const ops = [new Promise((res) => saveFocusModes(updated, res))];
      if (data[ACTIVE_MODE_STORAGE_KEY] === modeId) {
        ops.push(
          new Promise((res) =>
            chrome.storage.local.remove(ACTIVE_MODE_STORAGE_KEY, res)
          )
        );
      }
      Promise.all(ops).then(() => callback(true, updated));
    });
  });
}

// Expose for popup and tests.
if (typeof window !== "undefined") {
  window.FocusKitModes = {
    FOCUS_MODES_STORAGE_KEY,
    DEFAULT_FOCUS_MODES,
    loadFocusModes,
    saveFocusModes,
    createFocusMode,
    updateFocusMode,
    deleteFocusMode,
  };
}

if (typeof module !== "undefined") {
  module.exports = {
    FOCUS_MODES_STORAGE_KEY,
    DEFAULT_FOCUS_MODES,
    loadFocusModes,
    saveFocusModes,
    createFocusMode,
    updateFocusMode,
    deleteFocusMode,
  };
}
