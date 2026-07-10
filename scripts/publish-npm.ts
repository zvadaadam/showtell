#!/usr/bin/env bun
/** Build, verify, and publish the exact Showtell npm release tarballs. */
import { readFileSync } from "node:fs";
import { join } from "node:path";

const root = join(import.meta.dir, "..");
const { version } = JSON.parse(readFileSync(join(root, "package.json"), "utf-8")) as { version: string };
const binaryDirIndex = process.argv.indexOf("--binary-dir");
const binaryDir = binaryDirIndex === -1 ? undefined : process.argv[binaryDirIndex + 1];

function run(command: string[], stdout: "inherit" | "ignore" = "inherit"): Bun.SpawnSyncReturns<Buffer> {
  const result = Bun.spawnSync(command, { cwd: root, stdout, stderr: stdout });
  if (result.exitCode !== 0) throw new Error(`Command failed (${result.exitCode}): ${command.join(" ")}`);
  return result;
}

function isPublished(name: string): boolean {
  const result = Bun.spawnSync(["npm", "view", `${name}@${version}`, "version", "--json"], {
    cwd: root,
    stdout: "ignore",
    stderr: "ignore",
  });
  return result.exitCode === 0;
}

if (!binaryDir) {
  throw new Error(
    "Publishing requires --binary-dir with showtell-darwin-arm64, showtell-linux-x64, and showtell-linux-arm64.",
  );
}

run(["bun", "scripts/build-release.ts", "--binary-dir", binaryDir]);

const packages = ["showtell-darwin-arm64", "showtell-linux-x64", "showtell-linux-arm64", "showtell"];
for (const name of packages) {
  if (isPublished(name)) {
    process.stdout.write(`${JSON.stringify({ ok: true, package: name, version, skipped: "already published" })}\n`);
    continue;
  }
  run(["npm", "publish", join(root, "dist", "release", `${name}-${version}.tgz`), "--access", "public"]);
}
