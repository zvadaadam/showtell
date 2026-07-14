#!/usr/bin/env bun
/** Verify and publish the exact npm tarballs already assembled and smoke-tested by release CI. */
import { createHash } from "node:crypto";
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { RELEASE_TARGETS } from "./release-targets.ts";

const root = join(import.meta.dir, "..");
const { version } = JSON.parse(readFileSync(join(root, "package.json"), "utf-8")) as { version: string };
const releaseDir = join(root, "dist", "release");
const verifyOnly = process.argv.includes("--verify-only");

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

const packages = [...RELEASE_TARGETS.map((target) => target.packageName), "showtell"];
const sumsPath = join(releaseDir, "SHA256SUMS");
if (!existsSync(sumsPath)) throw new Error("Missing dist/release/SHA256SUMS. Run and smoke-test build:release first.");
const expectedSums = new Map(
  readFileSync(sumsPath, "utf-8")
    .trim()
    .split("\n")
    .map((line) => {
      const [digest, name] = line.trim().split(/\s+/, 2);
      return [name, digest] as const;
    }),
);

for (const name of packages) {
  const file = `${name}-${version}.tgz`;
  const path = join(releaseDir, file);
  if (!existsSync(path)) throw new Error(`Missing tested release package ${path}. Run build:release first.`);
  const actual = createHash("sha256").update(readFileSync(path)).digest("hex");
  if (expectedSums.get(file) !== actual) throw new Error(`Release checksum mismatch for ${file}; refusing to publish.`);
}

if (verifyOnly) {
  process.stdout.write(
    `${JSON.stringify({ ok: true, stage: "release-verify", version, packages, releaseDir }, null, 2)}\n`,
  );
  process.exit(0);
}

for (const name of packages) {
  if (isPublished(name)) {
    process.stdout.write(`${JSON.stringify({ ok: true, package: name, version, skipped: "already published" })}\n`);
    continue;
  }
  run(["npm", "publish", join(releaseDir, `${name}-${version}.tgz`), "--access", "public", "--provenance"]);
}
