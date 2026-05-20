// Run ESLint without modifying source files.
const { ESLint } = require("eslint");

const eslint = new ESLint({
  overrideConfigFile: true,
  overrideConfig: [
    {
      files: ["**/*.js"],
      ignores: [
        "node_modules/**",
        "coverage/**",
        "playwright-report/**",
        "test-results/**",
      ],
      languageOptions: {
        ecmaVersion: "latest",
        sourceType: "script",
        globals: {
          chrome: "readonly",
          clearInterval: "readonly",
          clearTimeout: "readonly",
          console: "readonly",
          document: "readonly",
          FocusKitModes: "readonly",
          FocusKitPomodoroState: "readonly",
          getComputedStyle: "readonly",
          global: "readonly",
          importScripts: "readonly",
          jest: "readonly",
          module: "readonly",
          process: "readonly",
          require: "readonly",
          setInterval: "readonly",
          setTimeout: "readonly",
          window: "readonly",
        },
      },
      rules: {
        "no-unused-vars": ["warn", { argsIgnorePattern: "^_" }],
        "no-undef": "error",
        "no-console": "off",
      },
    },
  ],
});

async function lintCode() {
  const results = await eslint.lintFiles(["./**/*.js"]);
  const formatter = await eslint.loadFormatter("stylish");
  const output = formatter.format(results);

  if (output) {
    console.log(output);
  }

  if (results.some((result) => result.errorCount > 0)) {
    process.exitCode = 1;
  }
}

lintCode().catch((error) => {
  process.exitCode = 1;
  console.error(error);
});
