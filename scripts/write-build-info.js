// write-build-info.js - writes the current Git commit for the popup watermark.

const fs = require("fs");
const path = require("path");
const { execFileSync } = require("child_process");

const projectRoot = path.resolve(__dirname, "..");
const outputPath = path.join(projectRoot, "build-info.js");

function readShortCommit() {
  if (process.env.GITHUB_SHA) {
    return process.env.GITHUB_SHA.slice(0, 7);
  }

  try {
    return execFileSync("git", ["rev-parse", "--short", "HEAD"], {
      cwd: projectRoot,
      encoding: "utf8",
    }).trim();
  } catch {
    return "dev";
  }
}

function writeBuildInfo(commit) {
  const contents = [
    "// build-info.js - generated popup build metadata for local extension verification.",
    `window.FocusKitBuildInfo = { commit: ${JSON.stringify(commit)} };`,
    "",
  ].join("\n");

  fs.writeFileSync(outputPath, contents, "utf8");
}

if (require.main === module) {
  writeBuildInfo(readShortCommit());
}

module.exports = { readShortCommit, writeBuildInfo };
