#!/usr/bin/env bun
/**
 * Build macOS release artifacts into dist/release/:
 *
 *   agent-video-v<V>-darwin-arm64.tar.gz   (binary named `agent-video` inside)
 *   agent-video-v<V>-darwin-x64.tar.gz
 *   agent-video-skill-v<V>.tar.gz          (drop into ~/.claude/skills/agent-video)
 *   SHA256SUMS
 *
 * macOS is the supported platform for v0.x (default TTS is the local `say`
 * engine and capture is AVFoundation-based). Linux targets can join the matrix
 * later by adding bun compile targets here.
 */
import { createHash } from "node:crypto";
import { mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";

const root = join(import.meta.dir, "..");
const releaseDir = join(root, "dist", "release");
const version = (JSON.parse(readFileSync(join(root, "package.json"), "utf-8")) as { version: string }).version;
const targets = ["darwin-arm64", "darwin-x64"] as const;

function run(cmd: string[], cwd: string = root): void {
  const proc = Bun.spawnSync(cmd, { cwd, stdout: "inherit", stderr: "inherit" });
  if (proc.exitCode !== 0) {
    throw new Error(`Command failed (${proc.exitCode}): ${cmd.join(" ")}`);
  }
}

rmSync(releaseDir, { recursive: true, force: true });
mkdirSync(releaseDir, { recursive: true });

const artifacts: string[] = [];

for (const target of targets) {
  const stageDir = join(releaseDir, `stage-${target}`);
  mkdirSync(stageDir, { recursive: true });
  run([
    "bun",
    "build",
    "packages/cli/src/index.ts",
    "--compile",
    `--target=bun-${target}`,
    "--outfile",
    join(stageDir, "agent-video"),
  ]);
  const tarName = `agent-video-v${version}-${target}.tar.gz`;
  run(["tar", "-czf", join(releaseDir, tarName), "-C", stageDir, "agent-video"]);
  rmSync(stageDir, { recursive: true, force: true });
  artifacts.push(tarName);
}

const skillTar = `agent-video-skill-v${version}.tar.gz`;
run(["tar", "-czf", join(releaseDir, skillTar), "-C", join(root, "skills"), "agent-video"]);
artifacts.push(skillTar);

const sums = artifacts
  .map((name) => {
    const digest = createHash("sha256")
      .update(readFileSync(join(releaseDir, name)))
      .digest("hex");
    return `${digest}  ${name}`;
  })
  .join("\n");
writeFileSync(join(releaseDir, "SHA256SUMS"), sums + "\n");

process.stdout.write(
  JSON.stringify({ ok: true, version, releaseDir, artifacts: [...artifacts, "SHA256SUMS"] }, null, 2) + "\n",
);
