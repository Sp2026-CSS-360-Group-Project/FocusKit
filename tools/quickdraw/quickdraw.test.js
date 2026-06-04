/* global Event, afterEach */
// quickdraw.test.js - DOM-level coverage for the QuickDraw RSVP reader page.

const fs = require("fs");
const path = require("path");

const htmlPath = path.join(__dirname, "quickdraw.html");
const rawHtml = fs.readFileSync(htmlPath, "utf8");
const bodyMatch = rawHtml.match(/<body[^>]*>([\s\S]*?)<\/body>/i);
const bodyMarkup = bodyMatch
  ? bodyMatch[1].replace(/<script[\s\S]*?<\/script>/gi, "")
  : "";

let storageState;

function mountQuickdraw() {
  jest.resetModules();
  document.body.innerHTML = bodyMarkup;

  storageState = {};

  global.chrome = {
    storage: {
      local: {
        get: jest.fn((keys, callback) => {
          const result = {};
          const requested = Array.isArray(keys) ? keys : [keys];

          requested.forEach((key) => {
            if (Object.prototype.hasOwnProperty.call(storageState, key)) {
              result[key] = storageState[key];
            }
          });

          callback(result);
        }),
        set: jest.fn((items, callback) => {
          Object.assign(storageState, items);

          if (typeof callback === "function") {
            callback();
          }
        }),
      },
    },
  };

  return require("./quickdraw.js");
}

function setInputValue(id, value) {
  const input = document.getElementById(id);

  input.value = value;
  input.dispatchEvent(new Event("change"));

  return input;
}

function clickById(id) {
  document.getElementById(id).click();
}

describe("QuickDraw HTML script ordering", () => {
  test("loads quickdrawState.js before quickdraw.js so the global is ready", () => {
    const stateScriptIndex = rawHtml.indexOf('<script src="quickdrawState.js"');
    const mainScriptIndex = rawHtml.indexOf('<script src="quickdraw.js"');

    expect(stateScriptIndex).toBeGreaterThan(-1);
    expect(mainScriptIndex).toBeGreaterThan(-1);
    expect(stateScriptIndex).toBeLessThan(mainScriptIndex);
  });
});

describe("QuickDraw reader page", () => {
  beforeEach(() => {
    jest.useFakeTimers();
    mountQuickdraw();
  });

  afterEach(() => {
    jest.useRealTimers();
    delete global.chrome;
  });

  test("hydrates the settings inputs from defaults when storage is empty", () => {
    expect(document.getElementById("wpsInput").value).toBe("3");
    expect(document.getElementById("fontSizeInput").value).toBe("48");
    expect(document.getElementById("fontColorInput").value).toBe("#ffffff");
    expect(document.getElementById("bgColorInput").value).toBe("#111827");
    expect(document.getElementById("pauseClauseInput").checked).toBe(true);
  });

  test("Go shows the reader screen and renders the first word immediately", () => {
    document.getElementById("textInput").value = "one two three";
    clickById("goBtn");

    expect(
      document.getElementById("inputScreen").classList.contains("hidden")
    ).toBe(true);
    expect(
      document.getElementById("readerScreen").classList.contains("hidden")
    ).toBe(false);
    expect(document.getElementById("currentWord").textContent).toBe("one");
  });

  test("advances to the next word after the interval elapses", () => {
    document.getElementById("textInput").value = "alpha beta gamma";
    clickById("goBtn");

    jest.advanceTimersByTime(334);

    expect(document.getElementById("currentWord").textContent).toBe("beta");

    jest.advanceTimersByTime(334);

    expect(document.getElementById("currentWord").textContent).toBe("gamma");
  });

  test("Pause halts advancement and relabels the button, Resume restarts it", () => {
    document.getElementById("textInput").value = "alpha beta gamma delta";
    clickById("goBtn");

    const pauseBtn = document.getElementById("pauseBtn");

    expect(pauseBtn.textContent).toBe("Pause");

    pauseBtn.click();

    expect(pauseBtn.textContent).toBe("Resume");

    jest.advanceTimersByTime(2000);

    expect(document.getElementById("currentWord").textContent).toBe("alpha");

    pauseBtn.click();

    expect(pauseBtn.textContent).toBe("Pause");

    jest.advanceTimersByTime(334);

    expect(document.getElementById("currentWord").textContent).toBe("beta");
  });

  test("Restart replays the words from the beginning", () => {
    document.getElementById("textInput").value = "alpha beta gamma";
    clickById("goBtn");

    jest.advanceTimersByTime(334);
    jest.advanceTimersByTime(334);

    expect(document.getElementById("currentWord").textContent).toBe("gamma");

    clickById("restartBtn");

    expect(document.getElementById("currentWord").textContent).toBe("alpha");
    expect(document.getElementById("pauseBtn").textContent).toBe("Pause");

    jest.advanceTimersByTime(334);

    expect(document.getElementById("currentWord").textContent).toBe("beta");
  });

  test("reaching the last word switches to the done screen", () => {
    document.getElementById("textInput").value = "one two";
    clickById("goBtn");

    jest.advanceTimersByTime(334);
    jest.advanceTimersByTime(334);

    expect(
      document.getElementById("readerScreen").classList.contains("hidden")
    ).toBe(true);
    expect(
      document.getElementById("doneScreen").classList.contains("hidden")
    ).toBe(false);
  });

  test("numeric settings inputs are clamped through the state helpers and persisted", () => {
    setInputValue("wpsInput", "99");
    setInputValue("fontSizeInput", "8");
    setInputValue("bgColorInput", "#112233");

    expect(document.getElementById("wpsInput").value).toBe("7");
    expect(document.getElementById("fontSizeInput").value).toBe("16");

    expect(chrome.storage.local.set).toHaveBeenCalled();
    const lastSetCall = chrome.storage.local.set.mock.calls.at(-1)[0];

    expect(lastSetCall.quickdrawSettings).toEqual(
      expect.objectContaining({
        wordsPerSecond: 7,
        fontSize: 16,
        backgroundColor: "#112233",
      })
    );
  });

  test("settings are applied to the word panel when Go runs", () => {
    setInputValue("fontSizeInput", "72");
    setInputValue("bgColorInput", "#112233");

    document.getElementById("textInput").value = "hello world";
    clickById("goBtn");

    const wordBox = document.querySelector(".word-box");

    expect(wordBox.style.fontSize).toBe("72px");
    expect(wordBox.style.backgroundColor).toMatch(
      /^(#112233|rgb\(17,\s*34,\s*51\))$/i
    );
  });

  test("lingers extra on words ending in a clause when the toggle is on", () => {
    document.getElementById("textInput").value = "Hello, world.";
    clickById("goBtn");

    expect(document.getElementById("currentWord").textContent).toBe("Hello,");

    // Base interval at the default 3 wps is 333ms. With the clause multiplier
    // of 2, advancing 334ms is not yet enough to leave the comma word.
    jest.advanceTimersByTime(334);
    expect(document.getElementById("currentWord").textContent).toBe("Hello,");

    jest.advanceTimersByTime(334);
    expect(document.getElementById("currentWord").textContent).toBe("world.");
  });

  test("uses the base interval for every word when the toggle is off", () => {
    const pauseToggle = document.getElementById("pauseClauseInput");

    pauseToggle.checked = false;
    pauseToggle.dispatchEvent(new Event("change"));

    document.getElementById("textInput").value = "Hello, world.";
    clickById("goBtn");

    expect(document.getElementById("currentWord").textContent).toBe("Hello,");

    jest.advanceTimersByTime(334);
    expect(document.getElementById("currentWord").textContent).toBe("world.");
  });

  test("the clause toggle is persisted to chrome.storage.local", () => {
    const pauseToggle = document.getElementById("pauseClauseInput");

    pauseToggle.checked = false;
    pauseToggle.dispatchEvent(new Event("change"));

    const lastSetCall = chrome.storage.local.set.mock.calls.at(-1)[0];

    expect(lastSetCall.quickdrawSettings.pauseOnClauseEnd).toBe(false);
  });

  test("New Text button returns to the input screen and stops the timer", () => {
    document.getElementById("textInput").value = "alpha beta gamma";
    clickById("goBtn");

    clickById("backBtn");

    expect(
      document.getElementById("inputScreen").classList.contains("hidden")
    ).toBe(false);

    jest.advanceTimersByTime(1000);

    expect(document.getElementById("currentWord").textContent).toBe("alpha");
  });
});
