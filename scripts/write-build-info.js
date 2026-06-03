// write-build-info.js - writes the current Git commit for the popup watermark.

const fs = require("fs");
const path = require("path");
const { execFileSync } = require("child_process");

const projectRoot = path.resolve(__dirname, "..");
const outputPath = path.join(projectRoot, "build-info.js");

function readShortCommit() {
  return execFileSync("git", ["rev-parse", "--short", "HEAD"], {
    cwd: projectRoot,
    encoding: "utf8",
  }).trim();
}

function writeBuildInfo(commit) {
  const contents = [
    "// build-info.js - generated popup build metadata for local extension verification.",
    `window.FocusKitBuildInfo = { commit: ${JSON.stringify(commit)} };`,
    "",
  ].join("\n");

  fs.writeFileSync(outputPath, contents, "utf8");
}

writeBuildInfo(readShortCommit());
