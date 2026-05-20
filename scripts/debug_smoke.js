// debug_smoke.js - temporary Playwright helper for inspecting extension smoke behavior.
const { chromium } = require("@playwright/test");
const fs = require("fs");
const path = require("path");

(async () => {
  const extensionPath = path.resolve(__dirname, "..");
  const userDataDir = fs.mkdtempSync(
    path.join(require("os").tmpdir(), "focuskit-debug-")
  );
  const context = await chromium.launchPersistentContext(userDataDir, {
    channel: "chromium",
    headless: true,
    args: [
      `--disable-extensions-except=${extensionPath}`,
      `--load-extension=${extensionPath}`,
    ],
  });

  let serviceWorker = context.serviceWorkers()[0];
  if (!serviceWorker) {
    serviceWorker = await context.waitForEvent("serviceworker");
  }
  console.log("Service worker url:", serviceWorker.url());
  try {
    const exists = await serviceWorker.evaluate(() => ({
      hasHandleMessage: typeof handleMessageAsync === "function",
      hasOnMessage:
        typeof chrome !== "undefined" &&
        !!chrome.runtime &&
        !!chrome.runtime.onMessage,
    }));
    console.log("Service worker exports:", exists);
  } catch (e) {
    console.log("Could not evaluate service worker:", e.message);
  }

  const extensionId = serviceWorker.url().split("/")[2];
  const page = await context.newPage();

  page.on("console", (msg) => console.log("PAGE LOG:", msg.type(), msg.text()));
  page.on("pageerror", (err) => console.error("PAGE ERROR:", err.message));

  await page.goto(`chrome-extension://${extensionId}/popup.html`);
  const html = await page.content();
  console.log("Popup HTML length:", html.length);
  console.log(html.slice(0, 1000));
  const hasTools = await page.evaluate(() => Boolean(window.TOOLS));
  console.log("window.TOOLS present?", hasTools);
  const hasFocusModes = await page.evaluate(() => Boolean(window.FOCUS_MODES));
  console.log("window.FOCUS_MODES present?", hasFocusModes);
  const hasSetupTabs = await page.evaluate(
    () => typeof setupTabs === "function"
  );
  console.log("setupTabs defined?", hasSetupTabs);
  const hasRenderTools = await page.evaluate(
    () => typeof renderTools === "function"
  );
  console.log("renderTools defined?", hasRenderTools);
  await page.waitForSelector(".tool-card");
  await page.click('button:has-text("Tools")');
  await page.waitForSelector('button[aria-label="Launch Pomodoro"]');
  await page.click('button[aria-label="Launch Pomodoro"]');

  console.log("Launched Pomodoro panel");

  await page.waitForSelector("#pomodoroPanel");
  console.log(
    "Pomodoro panel visible, initial time:",
    await page.$eval("#pomodoroTime", (el) => el.textContent)
  );

  await page.click('button:has-text("Start")');
  console.log("Clicked Start");

  // Quick check: directly ask background for state via runtime.sendMessage
  try {
    const bgState = await page.evaluate(
      () =>
        new Promise((res) =>
          chrome.runtime.sendMessage({ action: "pomodoro:getState" }, (r) =>
            res(r)
          )
        )
    );
    console.log("Background responded to getState:", bgState);
  } catch (e) {
    console.log("runtime.sendMessage test failed:", e.message);
  }

  // Poll storage and DOM
  for (let i = 0; i < 10; i++) {
    const storage = await page.evaluate(
      () =>
        new Promise((res) =>
          chrome.storage.local.get(["pomodoroState"], (data) =>
            res(data.pomodoroState)
          )
        )
    );
    const domTime = await page.$eval("#pomodoroTime", (el) => el.textContent);
    const status = await page.$eval("#pomodoroStatus", (el) => el.textContent);
    console.log(
      `Tick ${i}: storage=${JSON.stringify(storage)}, domTime=${domTime}, status=${status}`
    );
    await new Promise((r) => setTimeout(r, 1000));
  }

  await context.close();
})();
