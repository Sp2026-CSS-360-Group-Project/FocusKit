/* global FocusKitQuickdrawState */
// quickdraw.js - DOM wiring for the QuickDraw RSVP reader.
// Pure state helpers live in quickdrawState.js so this file stays focused on
// the page lifecycle (settings, timer, screen transitions).

// Prefer the global attached by quickdrawState.js in the browser; fall back to
// require() in Node/Jest. We guard the require call so the script does not crash
// in the browser if the state script tag is ever missing.
function loadQuickdrawStateHelpers() {
  if (typeof FocusKitQuickdrawState !== "undefined") {
    return FocusKitQuickdrawState;
  }

  if (typeof require === "function") {
    return require("./quickdrawState.js");
  }

  throw new Error(
    "QuickDraw state helpers are missing. Make sure quickdrawState.js loads before quickdraw.js."
  );
}

const quickdrawStateHelpers = loadQuickdrawStateHelpers();

const {
  DEFAULT_QUICKDRAW_SETTINGS,
  QUICKDRAW_SETTINGS_STORAGE_KEY,
  createQuickdrawSession,
  getDelayMsForWord,
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
  timeoutId: null,
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

// Push the current settings into every DOM input.
function writeSettingsToInputs(elements, settings) {
  elements.wpsInput.value = String(settings.wordsPerSecond);
  elements.fontSizeInput.value = String(settings.fontSize);
  elements.fontColorInput.value = settings.fontColor;
  elements.bgColorInput.value = settings.backgroundColor;
  elements.pauseClauseInput.checked = Boolean(settings.pauseOnClauseEnd);
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
    pauseOnClauseEnd: Boolean(elements.pauseClauseInput.checked),
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
    pauseClauseInput: document.getElementById("pauseClauseInput"),
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

  function stopScheduler() {
    if (readerSession.timeoutId !== null) {
      clearTimeout(readerSession.timeoutId);
      readerSession.timeoutId = null;
    }
  }

  function finishReading() {
    stopScheduler();
    readerSession.isRunning = false;
    showScreen(elements.doneScreen);
  }

  // Display the word at the current cursor and move the cursor forward by one.
  // Returns the displayed word (or null if we ran past the end of the session).
  function showCurrentAndAdvance() {
    if (readerSession.currentIndex >= readerSession.words.length) {
      finishReading();
      return null;
    }

    const word = readerSession.words[readerSession.currentIndex];

    elements.currentWord.textContent = word;
    readerSession.currentIndex += 1;
    return word;
  }

  // Queue the next tick. The dwell time is decided by getDelayMsForWord using
  // the word currently on screen, so clause / sentence endings linger when the
  // pauseOnClauseEnd setting is on.
  function scheduleNextTick() {
    stopScheduler();

    const lastShownIndex = readerSession.currentIndex - 1;
    const lastShownWord =
      lastShownIndex >= 0 ? readerSession.words[lastShownIndex] : "";
    const delayMs = getDelayMsForWord(lastShownWord, currentSettings);

    readerSession.timeoutId = setTimeout(() => {
      readerSession.timeoutId = null;
      showCurrentAndAdvance();

      if (readerSession.isRunning) {
        scheduleNextTick();
      }
    }, delayMs);
  }

  function startScheduler() {
    stopScheduler();
    readerSession.isRunning = true;
    elements.pauseBtn.textContent = PAUSE_LABEL;
    scheduleNextTick();
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
    showCurrentAndAdvance();
    startScheduler();
  }

  function handlePauseToggle() {
    if (!readerSession.words.length) {
      return;
    }

    if (readerSession.isRunning) {
      stopScheduler();
      readerSession.isRunning = false;
      elements.pauseBtn.textContent = RESUME_LABEL;
      return;
    }

    startScheduler();
  }

  function handleRestart() {
    if (!readerSession.words.length) {
      return;
    }

    stopScheduler();
    readerSession.currentIndex = 0;
    applyVisualSettingsToPanel(elements.wordBox, currentSettings);
    showCurrentAndAdvance();
    startScheduler();
  }

  function handleBackToInput() {
    stopScheduler();
    readerSession.isRunning = false;
    showScreen(elements.inputScreen);
  }

  function handleSettingsChange() {
    currentSettings = readSettingsFromInputs(elements);
    writeSettingsToInputs(elements, currentSettings);
    persistSettings(currentSettings);
    applyVisualSettingsToPanel(elements.wordBox, currentSettings);

    if (readerSession.isRunning) {
      startScheduler();
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
    elements.pauseClauseInput,
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
