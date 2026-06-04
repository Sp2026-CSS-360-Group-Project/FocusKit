// quickdrawState.js - pure state helpers for the QuickDraw RSVP reader.
// Kept free of DOM and chrome APIs so the logic is unit-testable in Jest.
(() => {
  // Storage key for the saved reader preferences.
  const QUICKDRAW_SETTINGS_STORAGE_KEY = "quickdrawSettings";
  // Storage key for the last text and reader position so reopening resumes cleanly.
  const QUICKDRAW_SESSION_STORAGE_KEY = "quickdrawSession";

  // Allowed range of words-per-second the user can pick from the input.
  const QUICKDRAW_MIN_WPS = 1;
  const QUICKDRAW_MAX_WPS = 7;
  // Allowed range of font sizes in pixels for the reader.
  const QUICKDRAW_MIN_FONT_SIZE = 16;
  const QUICKDRAW_MAX_FONT_SIZE = 96;

  // Safe defaults used the first time the reader opens.
  const DEFAULT_QUICKDRAW_SETTINGS = Object.freeze({
    wordsPerSecond: 3,
    fontSize: 48,
    fontColor: "#ffffff",
    backgroundColor: "#111827",
  });

  // Pull a value through a whitelist with a fallback so storage is always safe.
  function clampInteger(value, min, max, fallback) {
    const numeric = Number(value);

    if (!Number.isFinite(numeric)) {
      return fallback;
    }

    const rounded = Math.round(numeric);

    if (rounded < min) {
      return min;
    }

    if (rounded > max) {
      return max;
    }

    return rounded;
  }

  // Hex colors only - keep the saved setting free of CSS injection vectors.
  function normalizeHexColor(value, fallback) {
    if (typeof value !== "string") {
      return fallback;
    }

    const match = value.trim().toLowerCase().match(/^#([0-9a-f]{3}|[0-9a-f]{6})$/);

    if (!match) {
      return fallback;
    }

    const hex = match[1];

    if (hex.length === 3) {
      return (
        "#" +
        hex
          .split("")
          .map((character) => character + character)
          .join("")
      );
    }

    return "#" + hex;
  }

  // Merge any incoming values with the defaults to defend against missing keys.
  function normalizeQuickdrawSettings(input) {
    const source = input && typeof input === "object" ? input : {};

    return {
      wordsPerSecond: clampInteger(
        source.wordsPerSecond,
        QUICKDRAW_MIN_WPS,
        QUICKDRAW_MAX_WPS,
        DEFAULT_QUICKDRAW_SETTINGS.wordsPerSecond
      ),
      fontSize: clampInteger(
        source.fontSize,
        QUICKDRAW_MIN_FONT_SIZE,
        QUICKDRAW_MAX_FONT_SIZE,
        DEFAULT_QUICKDRAW_SETTINGS.fontSize
      ),
      fontColor: normalizeHexColor(
        source.fontColor,
        DEFAULT_QUICKDRAW_SETTINGS.fontColor
      ),
      backgroundColor: normalizeHexColor(
        source.backgroundColor,
        DEFAULT_QUICKDRAW_SETTINGS.backgroundColor
      ),
    };
  }

  // Split text into tokens suitable for the reader. Newlines split the flow
  // so very long pasted blocks still breathe; whitespace tokens are dropped.
  function tokenizeText(text) {
    if (typeof text !== "string" || !text) {
      return [];
    }

    return text
      .replace(/\r\n?/g, "\n")
      .split(/(\s+|\n+)/)
      .map((token) => token.trim())
      .filter((token) => token.length > 0);
  }

  // Parse the WPS input box, clamping to the supported range or returning null.
  function parseWordsPerSecondInput(value) {
    if (typeof value !== "string" || !value.trim()) {
      return null;
    }

    const numeric = Number(value);

    if (!Number.isFinite(numeric)) {
      return null;
    }

    return clampInteger(
      numeric,
      QUICKDRAW_MIN_WPS,
      QUICKDRAW_MAX_WPS,
      DEFAULT_QUICKDRAW_SETTINGS.wordsPerSecond
    );
  }

  // Parse the font size input box, clamping to the supported range or returning null.
  function parseFontSizeInput(value) {
    if (typeof value !== "string" || !value.trim()) {
      return null;
    }

    const numeric = Number(value);

    if (!Number.isFinite(numeric)) {
      return null;
    }

    return clampInteger(
      numeric,
      QUICKDRAW_MIN_FONT_SIZE,
      QUICKDRAW_MAX_FONT_SIZE,
      DEFAULT_QUICKDRAW_SETTINGS.fontSize
    );
  }

  // Restore a saved session while clamping the index back into a valid range.
  function restoreQuickdrawSession(savedSession, settings) {
    const safeSettings = normalizeQuickdrawSettings(settings);
    const fallback = {
      text: "",
      words: [],
      currentIndex: 0,
      isRunning: false,
      isComplete: false,
    };

    if (!savedSession || typeof savedSession !== "object") {
      return fallback;
    }

    const savedText = typeof savedSession.text === "string" ? savedSession.text : "";
    const words =
      Array.isArray(savedSession.words) && savedSession.words.length
        ? savedSession.words
        : tokenizeText(savedText);

    if (!words.length) {
      return { ...fallback, text: savedText };
    }

    const rawIndex = Number(savedSession.currentIndex);
    const currentIndex = Number.isFinite(rawIndex)
      ? Math.max(0, Math.min(words.length - 1, Math.floor(rawIndex)))
      : 0;

    return {
      text: savedText,
      words,
      currentIndex,
      isRunning: Boolean(savedSession.isRunning),
      isComplete: Boolean(savedSession.isComplete),
      settings: safeSettings,
    };
  }

  // Build the initial session state for a fresh paste of text.
  function createQuickdrawSession(text, settings) {
    const safeSettings = normalizeQuickdrawSettings(settings);
    const words = tokenizeText(text);

    return {
      text: typeof text === "string" ? text : "",
      words,
      currentIndex: 0,
      isRunning: words.length > 0,
      isComplete: words.length === 0,
      settings: safeSettings,
    };
  }

  // Compute how many milliseconds the reader should wait between words.
  function getIntervalMsForSettings(settings) {
    const safe = normalizeQuickdrawSettings(settings);

    return Math.max(1, Math.round(1000 / safe.wordsPerSecond));
  }

  const FocusKitQuickdrawState = {
    QUICKDRAW_MIN_WPS,
    QUICKDRAW_MAX_WPS,
    QUICKDRAW_MIN_FONT_SIZE,
    QUICKDRAW_MAX_FONT_SIZE,
    QUICKDRAW_SETTINGS_STORAGE_KEY,
    QUICKDRAW_SESSION_STORAGE_KEY,
    DEFAULT_QUICKDRAW_SETTINGS,
    clampInteger,
    normalizeHexColor,
    normalizeQuickdrawSettings,
    tokenizeText,
    parseWordsPerSecondInput,
    parseFontSizeInput,
    restoreQuickdrawSession,
    createQuickdrawSession,
    getIntervalMsForSettings,
  };

  if (typeof globalThis !== "undefined") {
    globalThis.FocusKitQuickdrawState = FocusKitQuickdrawState;
  }

  // Export pure helpers for Jest.
  if (typeof module !== "undefined") {
    module.exports = FocusKitQuickdrawState;
  }
})();
