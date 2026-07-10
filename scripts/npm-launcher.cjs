#!/usr/bin/env node
"use strict";

const { spawn } = require("node:child_process");
const { dirname, join } = require("node:path");

const PLATFORM_PACKAGES = {
  "darwin-arm64": "showtell-darwin-arm64",
  "linux-x64": "showtell-linux-x64",
  "linux-arm64": "showtell-linux-arm64",
};

function fail(message, hint) {
  process.stderr.write(`${JSON.stringify({ ok: false, error: { message, hint } }, null, 2)}\n`);
  process.exit(1);
}

const platform = `${process.platform}-${process.arch}`;
const packageName = PLATFORM_PACKAGES[platform];
if (!packageName) {
  fail(
    `Showtell does not provide a binary for ${platform}.`,
    "Supported platforms: macOS arm64, Linux x64, and Linux arm64.",
  );
}

let packageManifest;
try {
  packageManifest = require.resolve(`${packageName}/package.json`);
} catch {
  fail(
    `The ${packageName} binary package is missing.`,
    `Reinstall with optional dependencies enabled: npm install --global showtell@${require("../package.json").version}`,
  );
}

const binary = join(dirname(packageManifest), "bin", "showtell");
const child = spawn(binary, process.argv.slice(2), { stdio: "inherit", env: process.env });

for (const signal of ["SIGINT", "SIGTERM", "SIGHUP"]) {
  process.on(signal, () => child.kill(signal));
}

child.on("error", (error) => {
  fail(`Could not start the Showtell binary: ${error.message}`, `Reinstall ${packageName} and try again.`);
});

child.on("exit", (code, signal) => {
  if (signal) process.kill(process.pid, signal);
  else process.exit(code ?? 1);
});
