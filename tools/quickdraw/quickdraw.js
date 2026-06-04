/* global FocusKitQuickdrawState */
// quickdraw.js - DOM wiring for the QuickDraw RSVP reader.
// Pure state helpers live in quickdrawState.js so this file stays focused on
// the page lifecycle (settings, timer, screen transitions).

const quickdrawStateHelpers =
  typeof FocusKitQuickdrawState !== "undefined"
    ? FocusKitQuickdrawState
    : require("./quickdrawState.js");

const {
  DEFAULT_QUICKDRAW_SETTINGS,
  QUICKDRAW_SETTINGS_STORAGE_KEY,
  createQuickdrawSession,
  getIntervalMsForSettings,
  normalizeHexColor,
  normalizeQuickdrawSettings,
  parseFontSizeInput,
  parseWordsPerSecondInput,
} = quickdrawStateHelpers;

const PAUSE_LABEL = "Pause";
const RESUME_LABEL = "Resume";

// Mutable reader session; kept in module scope so the timer callback can mutate it.
const readerSession = {
  words: [],
  currentIndex: 0,
  isRunning: false,
  intervalId: null,
};

let currentSettings = { ...DEFAULT_QUICKDRAW_SETTINGS };

// Resolve a chrome.storage.local handle when present (browser), otherwise null (tests
// can mock it via global.chrome).
function getStorage() {
  if (typeof chrome !== "undefined" && chrome.storage && chrome.storage.local) {
    return chrome.storage.local;
  }

  return null;
}

// Persist the latest settings; safe to call when chrome.storage is absent (no-op).
function persistSettings(settings) {
  const storage = getStorage();

  if (!storage) {
    return;
  }

  storage.set({ [QUICKDRAW_SETTINGS_STORAGE_KEY]: settings });
}

// Pull saved settings out of chrome.storage.local, falling back to defaults.
function loadSettings(callback) {
  const storage = getStorage();

  if (!storage) {
    callback(normalizeQuickdrawSettings(null));
    return;
  }

  storage.get([QUICKDRAW_SETTINGS_STORAGE_KEY], (data) => {
    const saved =
      data && data[QUICKDRAW_SETTINGS_STORAGE_KEY]
        ? data[QUICKDRAW_SETTINGS_STORAGE_KEY]
        : null;

    callback(normalizeQuickdrawSettings(saved));
  });
}

// Push the current settings into the four DOM inputs.
function writeSettingsToInputs(elements, settings) {
  elements.wpsInput.value = String(settings.wordsPerSecond);
  elements.fontSizeInput.value = String(settings.fontSize);
  elements.fontColorInput.value = settings.fontColor;
  elements.bgColorInput.value = settings.backgroundColor;
}

// Read current settings from the inputs, clamping/normalizing through the helpers
// so the reader always works with safe values regardless of user input.
function readSettingsFromInputs(elements) {
  return normalizeQuickdrawSettings({
    wordsPerSecond:
      parseWordsPerSecondInput(elements.wpsInput.value) ??
      currentSettings.wordsPerSecond,
    fontSize:
      parseFontSizeInput(elements.fontSizeInput.value) ??
      currentSettings.fontSize,
    fontColor: normalizeHexColor(
      elements.fontColorInput.value,
      currentSettings.fontColor
    ),
    backgroundColor: normalizeHexColor(
      elements.bgColorInput.value,
      currentSettings.backgroundColor
    ),
  });
}

// Apply the visual settings to the reader panel so the user sees their choices.
function applyVisualSettingsToPanel(wordBox, settings) {
  if (!wordBox) {
    return;
  }

  wordBox.style.fontSize = settings.fontSize + "px";
  wordBox.style.color = settings.fontColor;
  wordBox.style.backgroundColor = settings.backgroundColor;
}

// Wire up every interactive element on the page. Safe to call once on load.
function setupQuickdraw() {
  const elements = {
    inputScreen: document.getElementById("inputScreen"),
    readerScreen: document.getElementById("readerScreen"),
    doneScreen: document.getElementById("doneScreen"),
    textInput: document.getElementById("textInput"),
    currentWord: document.getElementById("currentWord"),
    wordBox: document.querySelector(".word-box"),
    goBtn: document.getElementById("goBtn"),
    pauseBtn: document.getElementById("pauseBtn"),
    restartBtn: document.getElementById("restartBtn"),
    backBtn: document.getElementById("backBtn"),
    newTextBtn: document.getElementById("newTextBtn"),
    wpsInput: document.getElementById("wpsInput"),
    fontSizeInput: document.getElementById("fontSizeInput"),
    fontColorInput: document.getElementById("fontColorInput"),
    bgColorInput: document.getElementById("bgColorInput"),
  };

  if (!elements.goBtn) {
    return null;
  }

  function showScreen(screen) {
    elements.inputScreen.classList.add("hidden");
    elements.readerScreen.classList.add("hidden");
    elements.doneScreen.classList.add("hidden");
    screen.classList.remove("hidden");
  }

  function stopInterval() {
    if (readerSession.intervalId !== null) {
      clearInterval(readerSession.intervalId);
      readerSession.intervalId = null;
    }
  }

  function finishReading() {
    stopInterval();
    readerSession.isRunning = false;
    showScreen(elements.doneScreen);
  }

  // Advance one step: show the current word, then move the cursor forward. If the
  // cursor passes the last word the reader finishes and the done screen appears.
  function advanceOnce() {
    if (readerSession.currentIndex >= readerSession.words.length) {
      finishReading();
      return;
    }

    elements.currentWord.textContent =
      readerSession.words[readerSession.currentIndex];
    readerSession.currentIndex += 1;
  }

  function startInterval() {
    stopInterval();

    const intervalMs = getIntervalMsForSettings(currentSettings);

    readerSession.intervalId = setInterval(advanceOnce, intervalMs);
    readerSession.isRunning = true;
    elements.pauseBtn.textContent = PAUSE_LABEL;
  }

  function handleGo() {
    const text = elements.textInput.value;
    const session = createQuickdrawSession(text, currentSettings);

    if (!session.words.length) {
      return;
    }

    readerSession.words = session.words;
    readerSession.currentIndex = 0;
    applyVisualSettingsToPanel(elements.wordBox, currentSettings);
    showScreen(elements.readerScreen);
    advanceOnce();
    startInterval();
  }

  function handlePauseToggle() {
    if (!readerSession.words.length) {
      return;
    }

    if (readerSession.isRunning) {
      stopInterval();
      readerSession.isRunning = false;
      elements.pauseBtn.textContent = RESUME_LABEL;
      return;
    }

    startInterval();
  }

  function handleRestart() {
    if (!readerSession.words.length) {
      return;
    }

    stopInterval();
    readerSession.currentIndex = 0;
    applyVisualSettingsToPanel(elements.wordBox, currentSettings);
    advanceOnce();
    startInterval();
  }

  function handleBackToInput() {
    stopInterval();
    readerSession.isRunning = false;
    showScreen(elements.inputScreen);
  }

  function handleSettingsChange() {
    currentSettings = readSettingsFromInputs(elements);
    writeSettingsToInputs(elements, currentSettings);
    persistSettings(currentSettings);
    applyVisualSettingsToPanel(elements.wordBox, currentSettings);

    if (readerSession.isRunning) {
      startInterval();
    }
  }

  elements.goBtn.addEventListener("click", handleGo);
  elements.pauseBtn.addEventListener("click", handlePauseToggle);
  elements.restartBtn.addEventListener("click", handleRestart);
  elements.backBtn.addEventListener("click", handleBackToInput);
  elements.newTextBtn.addEventListener("click", handleBackToInput);

  [
    elements.wpsInput,
    elements.fontSizeInput,
    elements.fontColorInput,
    elements.bgColorInput,
  ].forEach((input) => {
    input.addEventListener("change", handleSettingsChange);
  });

  loadSettings((settings) => {
    currentSettings = settings;
    writeSettingsToInputs(elements, currentSettings);
    applyVisualSettingsToPanel(elements.wordBox, currentSettings);
  });

  return { elements };
}

if (typeof document !== "undefined" && document.getElementById("goBtn")) {
  setupQuickdraw();
}

if (typeof module !== "undefined") {
  module.exports = {
    setupQuickdraw,
    PAUSE_LABEL,
    RESUME_LABEL,
  };
}
