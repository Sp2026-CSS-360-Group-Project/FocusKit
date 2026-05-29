/* global chrome */

const DEFAULT_SETTINGS = {
  notifications: true,
  sound: false,
  dark: true,
};

const DEFAULT_SESSIONS = [];

async function saveSettings(settings) {
  try {
    await chrome.storage.local.set({ settings });
  } catch (error) {
    console.error("Failed to save settings:", error);
  }
}

async function loadSettings() {
  try {
    const result = await chrome.storage.local.get("settings");
    return result.settings ?? DEFAULT_SETTINGS;
  } catch (error) {
    console.error("Failed to load settings:", error);
    return DEFAULT_SETTINGS;
  }
}

async function saveSession(session) {
  try {
    const sessions = await loadSessions();
    sessions.push(session);
    await chrome.storage.local.set({ sessions });
  } catch (error) {
    console.error("Failed to save session:", error);
  }
}

async function loadSessions() {
  try {
    const result = await chrome.storage.local.get("sessions");
    return result.sessions ?? DEFAULT_SESSIONS;
  } catch (error) {
    console.error("Failed to load sessions:", error);
    return DEFAULT_SESSIONS;
  }
}

if (typeof globalThis !== "undefined") {
  globalThis.FocusKitStorage = {
    saveSettings,
    loadSettings,
    saveSession,
    loadSessions,
  };
}

if (typeof module !== "undefined") {
  module.exports = { saveSettings, loadSettings, saveSession, loadSessions };
}
