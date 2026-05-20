// Shared storage helpers and default settings for the FocusKit extension.

const DEFAULT_SETTINGS = {
  // Add when settings is created
};

const DEFAULT_FOCUS_MODES = [];

export async function saveSettings(settings) {
  try {
    await chrome.storage.local.set({ settings });
  } catch (error) {
    console.error("Failed to save settings:", error);
  }
}

export async function loadSettings() {
  try {
    const result = await chrome.storage.local.get("settings");
    return result.settings ?? DEFAULT_SETTINGS;
  } catch (error) {
    console.error("Failed to load settings:", error);
    return DEFAULT_SETTINGS;
  }
}

export async function saveFocusModes(modes) {
  try {
    await chrome.storage.local.set({ focusModes: modes });
  } catch (error) {
    console.error("Failed to save focus modes:", error);
  }
}

export async function loadFocusModes() {
  try {
    const result = await chrome.storage.local.get("focusModes");
    return result.focusModes ?? DEFAULT_FOCUS_MODES;
  } catch (error) {
    console.error("Failed to load focus modes:", error);
    return DEFAULT_FOCUS_MODES;
  }
}
