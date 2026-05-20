// focusModes.test.js - Unit tests for the focus mode CRUD module.

// Minimal chrome.storage.local stub used across all tests.
let store = {};
global.chrome = {
  storage: {
    local: {
      get: (keys, cb) => {
        const result = {};
        keys.forEach((k) => {
          if (store[k] !== undefined) result[k] = store[k];
        });
        cb(result);
      },
      set: (values, cb) => {
        Object.assign(store, values);
        if (cb) cb();
      },
      remove: (key, cb) => {
        delete store[key];
        if (cb) cb();
      },
    },
  },
};

const {
  FOCUS_MODES_STORAGE_KEY,
  DEFAULT_FOCUS_MODES,
  loadFocusModes,
  createFocusMode,
  updateFocusMode,
  deleteFocusMode,
} = require("./focusModes");

beforeEach(() => {
  store = {};
});

// loadFocusModes ---------------------------------------------------------------

test("loadFocusModes seeds defaults on first run", (done) => {
  loadFocusModes((modes) => {
    expect(modes).toEqual(DEFAULT_FOCUS_MODES);
    expect(store[FOCUS_MODES_STORAGE_KEY]).toEqual(DEFAULT_FOCUS_MODES);
    done();
  });
});

test("loadFocusModes returns stored modes when present", (done) => {
  const custom = [{ id: "x", name: "X", builtIn: false, enabledTools: [] }];
  store[FOCUS_MODES_STORAGE_KEY] = custom;
  loadFocusModes((modes) => {
    expect(modes).toEqual(custom);
    done();
  });
});

// createFocusMode --------------------------------------------------------------

test("createFocusMode appends a new mode with a generated id", (done) => {
  createFocusMode(
    "Flow",
    "Get into flow.",
    ["pomodoro"],
    {},
    (newMode, all) => {
      expect(newMode.name).toBe("Flow");
      expect(newMode.icon).toBe("F");
      expect(newMode.builtIn).toBe(false);
      expect(newMode.id).toMatch(/^custom-\d+$/);
      expect(all).toHaveLength(DEFAULT_FOCUS_MODES.length + 1);
      done();
    }
  );
});

test("createFocusMode trims whitespace from name and desc", (done) => {
  createFocusMode("  Sprint  ", "  Fast work.  ", [], {}, (newMode) => {
    expect(newMode.name).toBe("Sprint");
    expect(newMode.desc).toBe("Fast work.");
    done();
  });
});

// updateFocusMode --------------------------------------------------------------

test("updateFocusMode changes name without touching id or builtIn flag", (done) => {
  store[FOCUS_MODES_STORAGE_KEY] = [...DEFAULT_FOCUS_MODES];
  updateFocusMode("deep-work", { name: "Hyper Focus" }, (updated) => {
    const mode = updated.find((m) => m.id === "deep-work");
    expect(mode.name).toBe("Hyper Focus");
    expect(mode.id).toBe("deep-work");
    expect(mode.builtIn).toBe(true);
    done();
  });
});

test("updateFocusMode updates enabledTools on a custom mode", (done) => {
  const custom = {
    id: "custom-1",
    name: "My Mode",
    builtIn: false,
    enabledTools: ["pomodoro"],
    toolSettings: {},
  };
  store[FOCUS_MODES_STORAGE_KEY] = [custom];
  updateFocusMode(
    "custom-1",
    { enabledTools: ["pomodoro", "eisenhower"] },
    (updated) => {
      const mode = updated.find((m) => m.id === "custom-1");
      expect(mode.enabledTools).toEqual(["pomodoro", "eisenhower"]);
      done();
    }
  );
});

// deleteFocusMode --------------------------------------------------------------

test("deleteFocusMode removes a custom mode", (done) => {
  const custom = {
    id: "custom-99",
    name: "Temp",
    builtIn: false,
    enabledTools: [],
  };
  store[FOCUS_MODES_STORAGE_KEY] = [...DEFAULT_FOCUS_MODES, custom];
  deleteFocusMode("custom-99", (success, updated) => {
    expect(success).toBe(true);
    expect(updated.find((m) => m.id === "custom-99")).toBeUndefined();
    done();
  });
});

test("deleteFocusMode refuses to delete a built-in mode", (done) => {
  store[FOCUS_MODES_STORAGE_KEY] = [...DEFAULT_FOCUS_MODES];
  deleteFocusMode("deep-work", (success, updated) => {
    expect(success).toBe(false);
    expect(updated).toHaveLength(DEFAULT_FOCUS_MODES.length);
    done();
  });
});

test("deleteFocusMode clears active mode when the deleted mode was selected", (done) => {
  const custom = {
    id: "custom-55",
    name: "Gone",
    builtIn: false,
    enabledTools: [],
  };
  store[FOCUS_MODES_STORAGE_KEY] = [...DEFAULT_FOCUS_MODES, custom];
  store["focusMode"] = "custom-55";
  deleteFocusMode("custom-55", () => {
    expect(store["focusMode"]).toBeUndefined();
    done();
  });
});
