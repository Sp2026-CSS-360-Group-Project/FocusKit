// tools.test.js - verifies tool and focus-mode registries used by the popup.

const fs = require("fs");
const path = require("path");

// Mock chrome API before importing the runtime registry.
global.chrome = {
  storage: {
    local: {
      set: jest.fn(),
    },
  },
};

const { TOOLS, FOCUS_MODES } = require("./tools.js");

const projectRoot = __dirname;
const ignoredDirectories = new Set([
  ".git",
  "coverage",
  "node_modules",
  "playwright-report",
  "test-results",
]);

function collectJavaScriptFiles(directory) {
  return fs.readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
    if (ignoredDirectories.has(entry.name)) {
      return [];
    }

    const fullPath = path.join(directory, entry.name);

    if (entry.isDirectory()) {
      return collectJavaScriptFiles(fullPath);
    }

    return entry.isFile() && entry.name.endsWith(".js") ? [fullPath] : [];
  });
}

describe("TOOLS registry", () => {
  test("has the required productivity tools", () => {
    const ids = TOOLS.map((tool) => tool.id);

    expect(ids).toEqual(
      expect.arrayContaining(["pomodoro", "iris", "eisenhower"])
    );
  });

  test("every tool has complete render and launch data", () => {
    TOOLS.forEach((tool) => {
      expect(tool).toEqual(
        expect.objectContaining({
          id: expect.any(String),
          name: expect.any(String),
          icon: expect.any(String),
          desc: expect.any(String),
          launch: expect.any(Function),
        })
      );
    });
  });

  test("tool ids are unique", () => {
    const ids = TOOLS.map((tool) => tool.id);

    expect(new Set(ids).size).toBe(ids.length);
  });

  test("launch persists the selected tool without throwing", () => {
    const button = document.createElement("button");

    TOOLS[0].launch(button);

    expect(button.classList.contains("active-tool")).toBe(true);
    expect(chrome.storage.local.set).toHaveBeenCalledWith({
      activeTool: TOOLS[0].id,
    });
  });
});

describe("FOCUS_MODES registry", () => {
  test("has at least three focus modes", () => {
    expect(FOCUS_MODES.length).toBeGreaterThanOrEqual(3);
  });

  test("every mode has complete render data", () => {
    FOCUS_MODES.forEach((mode) => {
      expect(mode).toEqual(
        expect.objectContaining({
          id: expect.any(String),
          name: expect.any(String),
          icon: expect.any(String),
          desc: expect.any(String),
        })
      );
    });
  });
});

describe("JavaScript annotations", () => {
  test("every JavaScript file starts with a file-level comment", () => {
    const files = collectJavaScriptFiles(projectRoot);

    expect(files.length).toBeGreaterThan(0);

    files.forEach((file) => {
      const firstLine = fs
        .readFileSync(file, "utf8")
        .split(/\r?\n/)
        .find((line) => line.trim().length > 0);

      expect(firstLine).toMatch(/^\/\/|^\/\*/);
    });
  });
});
