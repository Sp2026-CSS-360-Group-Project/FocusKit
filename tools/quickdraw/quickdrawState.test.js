// quickdrawState.test.js - unit tests for the QuickDraw RSVP reader helpers.

const {
  DEFAULT_QUICKDRAW_SETTINGS,
  QUICKDRAW_MAX_FONT_SIZE,
  QUICKDRAW_MAX_WPS,
  QUICKDRAW_MIN_FONT_SIZE,
  QUICKDRAW_MIN_WPS,
  QUICKDRAW_SETTINGS_STORAGE_KEY,
  QUICKDRAW_SESSION_STORAGE_KEY,
  clampInteger,
  createQuickdrawSession,
  getIntervalMsForSettings,
  normalizeHexColor,
  normalizeQuickdrawSettings,
  parseFontSizeInput,
  parseWordsPerSecondInput,
  restoreQuickdrawSession,
  tokenizeText,
} = require("./quickdrawState.js");

describe("clampInteger", () => {
  test("returns the fallback for non-numeric values", () => {
    expect(clampInteger(undefined, 1, 7, 3)).toBe(3);
    expect(clampInteger("abc", 1, 7, 3)).toBe(3);
  });

  test("clamps values below the minimum", () => {
    expect(clampInteger(-5, 1, 7, 3)).toBe(1);
  });

  test("clamps values above the maximum", () => {
    expect(clampInteger(99, 1, 7, 3)).toBe(7);
  });

  test("rounds valid values to the nearest integer", () => {
    expect(clampInteger(3.4, 1, 7, 3)).toBe(3);
    expect(clampInteger(3.6, 1, 7, 3)).toBe(4);
  });
});

describe("normalizeHexColor", () => {
  test("accepts 6-character hex colors", () => {
    expect(normalizeHexColor("#aabbcc", "#ffffff")).toBe("#aabbcc");
  });

  test("expands 3-character hex colors", () => {
    expect(normalizeHexColor("#abc", "#ffffff")).toBe("#aabbcc");
  });

  test("lowercases hex values for stable comparisons", () => {
    expect(normalizeHexColor("#AABBCC", "#ffffff")).toBe("#aabbcc");
  });

  test("falls back when the value is not a hex color", () => {
    expect(normalizeHexColor("rgb(0, 0, 0)", "#ffffff")).toBe("#ffffff");
    expect(normalizeHexColor("black", "#ffffff")).toBe("#ffffff");
    expect(normalizeHexColor(null, "#ffffff")).toBe("#ffffff");
  });
});

describe("normalizeQuickdrawSettings", () => {
  test("returns defaults for missing or invalid input", () => {
    expect(normalizeQuickdrawSettings(null)).toEqual(
      DEFAULT_QUICKDRAW_SETTINGS
    );
    expect(normalizeQuickdrawSettings({})).toEqual(DEFAULT_QUICKDRAW_SETTINGS);
  });

  test("clamps WPS and font size to the allowed range", () => {
    const settings = normalizeQuickdrawSettings({
      wordsPerSecond: 99,
      fontSize: 1,
    });

    expect(settings.wordsPerSecond).toBe(QUICKDRAW_MAX_WPS);
    expect(settings.fontSize).toBe(QUICKDRAW_MIN_FONT_SIZE);
  });

  test("normalizes colors and fills in defaults for missing keys", () => {
    const settings = normalizeQuickdrawSettings({
      wordsPerSecond: 5,
      fontSize: 64,
      fontColor: "#ABC",
      backgroundColor: "not-a-color",
    });

    expect(settings.wordsPerSecond).toBe(5);
    expect(settings.fontSize).toBe(64);
    expect(settings.fontColor).toBe("#aabbcc");
    expect(settings.backgroundColor).toBe(
      DEFAULT_QUICKDRAW_SETTINGS.backgroundColor
    );
  });
});

describe("tokenizeText", () => {
  test("returns an empty list for non-strings or empty input", () => {
    expect(tokenizeText("")).toEqual([]);
    expect(tokenizeText(null)).toEqual([]);
    expect(tokenizeText(undefined)).toEqual([]);
  });

  test("splits on whitespace and skips empty tokens", () => {
    expect(tokenizeText("hello world")).toEqual(["hello", "world"]);
  });

  test("collapses tabs, newlines, and repeated spaces", () => {
    expect(tokenizeText("a\tb\n\nc   d")).toEqual(["a", "b", "c", "d"]);
  });
});

describe("parseWordsPerSecondInput", () => {
  test("returns null for empty or non-numeric input", () => {
    expect(parseWordsPerSecondInput("")).toBeNull();
    expect(parseWordsPerSecondInput("abc")).toBeNull();
  });

  test("clamps out-of-range values", () => {
    expect(parseWordsPerSecondInput("0")).toBe(QUICKDRAW_MIN_WPS);
    expect(parseWordsPerSecondInput("99")).toBe(QUICKDRAW_MAX_WPS);
  });

  test("parses in-range values", () => {
    expect(parseWordsPerSecondInput("3")).toBe(3);
    expect(parseWordsPerSecondInput(" 6 ")).toBe(6);
  });
});

describe("parseFontSizeInput", () => {
  test("returns null for empty or non-numeric input", () => {
    expect(parseFontSizeInput("")).toBeNull();
    expect(parseFontSizeInput("abc")).toBeNull();
  });

  test("clamps out-of-range values", () => {
    expect(parseFontSizeInput("8")).toBe(QUICKDRAW_MIN_FONT_SIZE);
    expect(parseFontSizeInput("200")).toBe(QUICKDRAW_MAX_FONT_SIZE);
  });

  test("parses in-range values", () => {
    expect(parseFontSizeInput("48")).toBe(48);
  });
});

describe("createQuickdrawSession", () => {
  test("returns an empty session for empty text", () => {
    const session = createQuickdrawSession("", DEFAULT_QUICKDRAW_SETTINGS);

    expect(session.words).toEqual([]);
    expect(session.isRunning).toBe(false);
    expect(session.isComplete).toBe(true);
  });

  test("tokens text and starts the reader running", () => {
    const session = createQuickdrawSession(
      "Hello world",
      DEFAULT_QUICKDRAW_SETTINGS
    );

    expect(session.words).toEqual(["Hello", "world"]);
    expect(session.currentIndex).toBe(0);
    expect(session.isRunning).toBe(true);
    expect(session.isComplete).toBe(false);
    expect(session.text).toBe("Hello world");
  });
});

describe("restoreQuickdrawSession", () => {
  test("clamps currentIndex back into a valid range", () => {
    const session = restoreQuickdrawSession(
      {
        text: "a b c",
        words: ["a", "b", "c"],
        currentIndex: 99,
        isRunning: true,
        isComplete: false,
      },
      DEFAULT_QUICKDRAW_SETTINGS
    );

    expect(session.currentIndex).toBe(2);
    expect(session.words).toEqual(["a", "b", "c"]);
    expect(session.isRunning).toBe(true);
  });

  test("retokenizes text when no words are saved", () => {
    const session = restoreQuickdrawSession(
      { text: "one two", currentIndex: 0 },
      DEFAULT_QUICKDRAW_SETTINGS
    );

    expect(session.words).toEqual(["one", "two"]);
  });

  test("returns a blank session when no saved data exists", () => {
    const session = restoreQuickdrawSession(null, DEFAULT_QUICKDRAW_SETTINGS);

    expect(session.words).toEqual([]);
    expect(session.isRunning).toBe(false);
  });
});

describe("getIntervalMsForSettings", () => {
  test("matches the configured words-per-second", () => {
    expect(
      getIntervalMsForSettings({
        ...DEFAULT_QUICKDRAW_SETTINGS,
        wordsPerSecond: 4,
      })
    ).toBe(250);
  });

  test("never returns less than 1 ms to keep setInterval sane", () => {
    expect(
      getIntervalMsForSettings({
        ...DEFAULT_QUICKDRAW_SETTINGS,
        wordsPerSecond: 1000,
      })
    ).toBeGreaterThanOrEqual(1);
  });
});

describe("storage keys", () => {
  test("exposes the expected chrome.storage keys", () => {
    expect(QUICKDRAW_SETTINGS_STORAGE_KEY).toBe("quickdrawSettings");
    expect(QUICKDRAW_SESSION_STORAGE_KEY).toBe("quickdrawSession");
  });
});
