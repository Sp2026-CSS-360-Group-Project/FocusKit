/* global afterEach, describe, expect, jest, test */
// write-build-info.test.js - verifies build metadata commit resolution.

const childProcess = require("child_process");

jest.mock("child_process", () => ({
  execFileSync: jest.fn(),
}));

describe("readShortCommit", () => {
  const originalGithubSha = process.env.GITHUB_SHA;

  afterEach(() => {
    jest.resetModules();
    childProcess.execFileSync.mockReset();

    if (originalGithubSha === undefined) {
      delete process.env.GITHUB_SHA;
    } else {
      process.env.GITHUB_SHA = originalGithubSha;
    }
  });

  test("uses GitHub Actions sha before calling git", () => {
    process.env.GITHUB_SHA = "abcdef1234567890";
    const { readShortCommit } = require("./write-build-info.js");

    expect(readShortCommit()).toBe("abcdef1");
    expect(childProcess.execFileSync).not.toHaveBeenCalled();
  });

  test("falls back to dev when git fails", () => {
    delete process.env.GITHUB_SHA;
    childProcess.execFileSync.mockImplementation(() => {
      throw new Error("dubious ownership");
    });
    const { readShortCommit } = require("./write-build-info.js");

    expect(readShortCommit()).toBe("dev");
  });
});
