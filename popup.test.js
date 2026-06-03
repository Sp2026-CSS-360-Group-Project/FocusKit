// popup.test.js - verifies small popup helper behavior outside Chrome runtime.

describe("build watermark rendering", () => {
  let renderBuildWatermark;

  beforeEach(() => {
    jest.resetModules();
    document.body.innerHTML = `<div id="buildWatermark"></div>`;
    delete global.FocusKitBuildInfo;
    ({ renderBuildWatermark } = require("./popup.js"));
  });

  test("renders the generated build commit", () => {
    global.FocusKitBuildInfo = { commit: "abcdef1" };

    renderBuildWatermark();

    expect(document.getElementById("buildWatermark").textContent).toBe(
      "build: abcdef1"
    );
  });

  test("falls back to dev when build info is missing", () => {
    renderBuildWatermark();

    expect(document.getElementById("buildWatermark").textContent).toBe(
      "build: dev"
    );
  });
});
