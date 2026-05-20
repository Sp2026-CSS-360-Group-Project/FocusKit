const browserGlobals = {
  chrome: "readonly",
  clearInterval: "readonly",
  clearTimeout: "readonly",
  console: "readonly",
  document: "readonly",
  FocusKitModes: "readonly",
  FocusKitPomodoroState: "readonly",
  getComputedStyle: "readonly",
  importScripts: "readonly",
  setInterval: "readonly",
  setTimeout: "readonly",
  window: "readonly",
};

const nodeGlobals = {
  __dirname: "readonly",
  global: "readonly",
  module: "readonly",
  process: "readonly",
  require: "readonly",
};

const testGlobals = {
  beforeEach: "readonly",
  describe: "readonly",
  expect: "readonly",
  jest: "readonly",
  test: "readonly",
};

export default [
  {
    ignores: [
      "node_modules/**",
      "coverage/**",
      "playwright-report/**",
      "test-results/**",
    ],
  },
  {
    files: ["**/*.js"],
    languageOptions: {
      ecmaVersion: "latest",
      sourceType: "module",
      globals: {
        ...browserGlobals,
        ...nodeGlobals,
        ...testGlobals,
      },
    },
    rules: {
      "no-console": "off",
      "no-undef": "error",
      "no-unused-vars": ["warn", { argsIgnorePattern: "^_" }],
    },
  },
];
