// smoke.extension.spec.js - loads the MV3 extension in Chromium and checks popup behavior.

const fs = require("fs");
const os = require("os");
const path = require("path");
const { test, expect, chromium } = require("@playwright/test");

const extensionPath = path.resolve(__dirname, "..");

async function readComputedColors(locator) {
  return locator.evaluate((element) => {
    const styles = getComputedStyle(element);

    return {
      background: styles.backgroundColor,
      text: styles.color,
    };
  });
}

function rgbValues(color) {
  const values = color.match(/\d+(\.\d+)?/g).map(Number);

  return values.slice(0, 3);
}

function luminance(color) {
  const [red, green, blue] = rgbValues(color);

  return 0.2126 * red + 0.7152 * green + 0.0722 * blue;
}

function rgbBrightness(color) {
  const [red, green, blue] = rgbValues(color);

  return (red + green + blue) / 3;
}

function expectLightTheme(colors) {
  expect(rgbBrightness(colors.background)).toBeGreaterThan(220);
  expect(luminance(colors.text)).toBeLessThan(80);
}

function expectDarkTheme(colors) {
  expect(rgbBrightness(colors.background)).toBeLessThan(40);
  expect(luminance(colors.text)).toBeGreaterThan(220);
}

async function expectPomodoroWorks(page) {
  await page.getByRole("button", { name: "Tools" }).click();
  await page.getByRole("button", { name: "Launch Pomodoro" }).click();

  const panel = page.locator("#pomodoroPanel");
  const display = page.locator("#pomodoroTime");

  await expect(panel).toBeVisible();
  await expect(display).toHaveText("25:00");
  await expect(page.getByRole("button", { name: "Start" })).toBeVisible();
  await expect(page.getByRole("button", { name: "Pause" })).toBeVisible();
  await expect(page.getByRole("button", { name: "Reset" })).toBeVisible();
  await expect(page.getByRole("button", { name: "Close" })).toBeVisible();

  await page.getByRole("button", { name: "Start" }).click();
  await page.waitForFunction(
    () =>
      new Promise((resolve) => {
        chrome.storage.local.get(["pomodoroState"], (data) => {
          resolve(Boolean(data.pomodoroState && data.pomodoroState.isRunning));
        });
      })
  );
  await expect(page.locator("#pomodoroStatus")).toHaveText("Running");

  await page.waitForFunction(
    () => document.querySelector("#pomodoroTime").textContent !== "25:00"
  );
  const runningDisplay = await display.textContent();

  await page.getByRole("button", { name: "Pause" }).click();
  await page.waitForFunction(
    () =>
      new Promise((resolve) => {
        chrome.storage.local.get(["pomodoroState"], (data) => {
          resolve(
            Boolean(
              data.pomodoroState && data.pomodoroState.isRunning === false
            )
          );
        });
      })
  );
  await expect(page.locator("#pomodoroStatus")).toHaveText("Paused");
  await expect(display).toHaveText(runningDisplay);

  await page.reload({ waitUntil: "domcontentloaded" });
  await page.getByRole("button", { name: "Launch Pomodoro" }).click();
  await expect(panel).toBeVisible();
  await expect(display).toHaveText(runningDisplay);
  await expect(page.locator("#pomodoroStatus")).toHaveText("Paused");

  await page.getByRole("button", { name: "Reset" }).click();
  await expect(display).toHaveText("25:00");
  await page.waitForFunction(
    () =>
      new Promise((resolve) => {
        chrome.storage.local.get(["pomodoroState"], (data) => {
          resolve(
            Boolean(
              data.pomodoroState &&
              data.pomodoroState.remainingSeconds === 1500 &&
              data.pomodoroState.isRunning === false
            )
          );
        });
      })
  );

  await page.getByRole("button", { name: "Close" }).click();
  await expect(panel).toBeHidden();
  await expect(page.locator("#toolsList")).toBeVisible();
}

test("FocusKit popup renders core features without console errors", async () => {
  const userDataDir = fs.mkdtempSync(path.join(os.tmpdir(), "focuskit-smoke-"));
  const context = await chromium.launchPersistentContext(userDataDir, {
    channel: "chromium",
    headless: true,
    args: [
      `--disable-extensions-except=${extensionPath}`,
      `--load-extension=${extensionPath}`,
    ],
  });

  const errors = [];

  try {
    let serviceWorker = context.serviceWorkers()[0];

    if (!serviceWorker) {
      serviceWorker = await context.waitForEvent("serviceworker");
    }

    const extensionId = serviceWorker.url().split("/")[2];
    const page = await context.newPage();

    page.on("pageerror", (error) => {
      errors.push(error.message);
    });

    page.on("console", (message) => {
      if (message.type() === "error") {
        errors.push(message.text());
      }
    });

    await page.goto(`chrome-extension://${extensionId}/popup.html`);
    await expect(page).toHaveURL(
      new RegExp(`^chrome-extension://${extensionId}/popup\\.html$`)
    );
    const body = page.locator("body");
    const popupSurface = page.locator(".app");
    const firstToolCard = page.locator(".tool-card").first();
    const logoText = page.locator(".logo-text");

    await expect(page.locator("body")).toHaveClass(/theme-dark/);
    await expect(popupSurface).toHaveClass(/theme-dark/);

    await expect(page.getByText("Pomodoro", { exact: true })).toBeVisible();
    await expect(page.getByText("Iris", { exact: true })).toBeVisible();
    await expect(page.getByText("Eisenhower", { exact: true })).toBeVisible();
    await expectPomodoroWorks(page);

    const initialDarkSurfaceColors = await readComputedColors(popupSurface);
    const initialDarkCardColors = await readComputedColors(firstToolCard);
    const initialDarkTextColors = await readComputedColors(logoText);
    expectDarkTheme(initialDarkSurfaceColors);
    expectDarkTheme(initialDarkCardColors);
    expect(luminance(initialDarkTextColors.text)).toBeGreaterThan(220);

    await page.getByRole("button", { name: "Focus" }).click();
    await expect(page.locator("#tab-focus.active .focus-card")).toHaveCount(3);
    await expect(
      page.locator("#tab-focus.active .focus-card").first()
    ).toBeVisible();

    await page.getByRole("button", { name: "Settings" }).click();
    await expect(page.locator("#tab-settings.active")).toBeVisible();
    await expect(
      page.getByText("Notifications", { exact: true })
    ).toBeVisible();
    await expect(
      page.getByText("Sound effects", { exact: true })
    ).toBeVisible();
    await expect(page.getByText("Dark mode", { exact: true })).toBeVisible();
    await expect(
      page.getByText("Auto-start timer", { exact: true })
    ).toHaveCount(0);

    const notifications = page.locator("#settingNotifications");
    const sound = page.locator("#settingSound");
    const dark = page.locator("#settingDark");
    const darkModeSettingRow = page.locator(".setting-row", {
      hasText: "Dark mode",
    });
    const darkModeSettingText = darkModeSettingRow.locator(".setting-label");

    await expect(dark).toBeChecked();
    const darkSettingRowColors = await readComputedColors(darkModeSettingRow);
    expectDarkTheme(darkSettingRowColors);

    await page
      .locator(".setting-row", { hasText: "Notifications" })
      .locator(".slider")
      .click();
    await page
      .locator(".setting-row", { hasText: "Sound effects" })
      .locator(".slider")
      .click();
    await page
      .locator(".setting-row", { hasText: "Dark mode" })
      .locator(".slider")
      .click();
    await expect(body).toHaveClass(/theme-light/);
    await expect(popupSurface).toHaveClass(/theme-light/);
    await expectPomodoroWorks(page);

    const lightSurfaceColors = await readComputedColors(popupSurface);
    const lightCardColors = await readComputedColors(firstToolCard);
    const lightSettingRowColors = await readComputedColors(darkModeSettingRow);
    const lightTextColors = await readComputedColors(darkModeSettingText);
    expectLightTheme(lightSurfaceColors);
    expectLightTheme(lightCardColors);
    expectLightTheme(lightSettingRowColors);
    expect(luminance(lightTextColors.text)).toBeLessThan(80);
    expect(rgbBrightness(lightSurfaceColors.background)).toBeGreaterThan(
      rgbBrightness(initialDarkSurfaceColors.background) + 80
    );
    expect(rgbBrightness(lightCardColors.background)).toBeGreaterThan(
      rgbBrightness(initialDarkCardColors.background) + 80
    );
    expect(rgbBrightness(lightSettingRowColors.background)).toBeGreaterThan(
      rgbBrightness(darkSettingRowColors.background) + 80
    );
    expect(lightTextColors.text).not.toBe(initialDarkTextColors.text);

    await page.waitForFunction(
      () =>
        new Promise((resolve) => {
          chrome.storage.local.get(
            ["notifications", "sound", "dark"],
            (data) => {
              resolve(
                data.notifications === false &&
                  data.sound === true &&
                  data.dark === false
              );
            }
          );
        })
    );

    await page.reload({ waitUntil: "domcontentloaded" });
    await page.getByRole("button", { name: "Settings" }).click();

    await expect(notifications).not.toBeChecked();
    await expect(sound).toBeChecked();
    await expect(dark).not.toBeChecked();
    await expect(body).toHaveClass(/theme-light/);
    await expect(popupSurface).toHaveClass(/theme-light/);
    expectLightTheme(await readComputedColors(popupSurface));
    expectLightTheme(await readComputedColors(darkModeSettingRow));

    await page.evaluate(
      () =>
        new Promise((resolve) => {
          chrome.storage.local.set({ dark: true }, resolve);
        })
    );
    await page.reload({ waitUntil: "domcontentloaded" });
    await page.getByRole("button", { name: "Settings" }).click();
    await expect(dark).toBeChecked();
    await expect(body).toHaveClass(/theme-dark/);
    await expect(popupSurface).toHaveClass(/theme-dark/);
    const restoredDarkSurfaceColors = await readComputedColors(popupSurface);
    const restoredDarkRowColors = await readComputedColors(darkModeSettingRow);
    const restoredDarkTextColors =
      await readComputedColors(darkModeSettingText);
    expectDarkTheme(restoredDarkSurfaceColors);
    expectDarkTheme(restoredDarkRowColors);
    expect(luminance(restoredDarkTextColors.text)).toBeGreaterThan(220);
    expect(rgbBrightness(restoredDarkSurfaceColors.background)).toBeLessThan(
      rgbBrightness(lightSurfaceColors.background) - 80
    );
    expect(rgbBrightness(restoredDarkRowColors.background)).toBeLessThan(
      rgbBrightness(lightSettingRowColors.background) - 80
    );

    await page.evaluate(
      () =>
        new Promise((resolve) => {
          chrome.storage.local.set({ dark: false }, resolve);
        })
    );
    await page.reload({ waitUntil: "domcontentloaded" });
    await page.getByRole("button", { name: "Settings" }).click();
    await expect(dark).not.toBeChecked();
    await expect(body).toHaveClass(/theme-light/);
    await expect(popupSurface).toHaveClass(/theme-light/);
    expectLightTheme(await readComputedColors(popupSurface));
    expectLightTheme(await readComputedColors(darkModeSettingRow));

    expect(errors).toEqual([]);
  } finally {
    await context.close();
    fs.rmSync(userDataDir, { recursive: true, force: true });
  }
});
