// content.test.js - validates content script DOM helpers with a mocked Chrome API.

// Mock the chrome API before importing content.js.
global.chrome = {
  runtime: {
    onMessage: {
      addListener: jest.fn(),
    },
  },
};

const { doSomething } = require("./content.js");

describe("doSomething()", () => {
  beforeEach(() => {
    document.body.innerHTML = "";
  });

  test("returns 0 links when page has no anchors", () => {
    document.body.innerHTML = "<p>No links here</p>";
    expect(doSomething()).toBe("Found 0 link(s) on this page.");
  });

  test("counts a single anchor tag", () => {
    document.body.innerHTML = `<a href="https://example.test">Click me</a>`;
    expect(doSomething()).toBe("Found 1 link(s) on this page.");
  });

  test("counts multiple anchor tags", () => {
    document.body.innerHTML = `
      <a href="/one">One</a>
      <a href="/two">Two</a>
      <a href="/three">Three</a>
    `;
    expect(doSomething()).toBe("Found 3 link(s) on this page.");
  });
});
