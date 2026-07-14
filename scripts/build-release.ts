#!/usr/bin/env bun
/** Build native archives plus npm tarballs into dist/release. */
import { createHash } from "node:crypto";
import { chmodSync, copyFileSync, cpSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { RELEASE_TARGETS, releaseTarget, type PlatformId } from "./release-targets.ts";
import { extractBrowserArchive, stageInstalledBrowser, writeBrowserArchive } from "./browser-bundle.ts";
import { compileCli } from "./compile-cli.ts";

const root = join(import.meta.dir, "..");
const releaseDir = join(root, "dist", "release");
const version = (JSON.parse(readFileSync(join(root, "package.json"), "utf-8")) as { version: string }).version;
const platformIds = RELEASE_TARGETS.map(({ id }) => id);
const args = process.argv.slice(2);
const playerDir = join(root, "packages", "player", "dist", "client");

function valueAfter(flag: string): string | undefined {
  const index = args.indexOf(flag);
  return index === -1 ? undefined : args[index + 1];
}

function run(cmd: string[], cwd: string = root): void {
  const proc = Bun.spawnSync(cmd, { cwd, stdout: "inherit", stderr: "inherit" });
  if (proc.exitCode !== 0) throw new Error(`Command failed (${proc.exitCode}): ${cmd.join(" ")}`);
}

function hostPlatform(): PlatformId {
  const id = `${process.platform}-${process.arch}` as PlatformId;
  if (!platformIds.includes(id)) {
    throw new Error(`Unsupported release host ${id}. Use --binary-dir with prebuilt native binaries.`);
  }
  return id;
}

rmSync(releaseDir, { recursive: true, force: true });
mkdirSync(releaseDir, { recursive: true });
run(["bun", "run", "build:player"]);

const suppliedBinaryDir = valueAfter("--binary-dir");
const selectedPlatforms = suppliedBinaryDir ? platformIds : [hostPlatform()];
const binaryDir = suppliedBinaryDir ?? join(releaseDir, "bin");
mkdirSync(binaryDir, { recursive: true });

if (!suppliedBinaryDir) {
  const platform = selectedPlatforms[0]!;
  compileCli(join(binaryDir, `showtell-${platform}`), releaseTarget(platform)!.bunTarget);
}

const artifacts: string[] = [];
for (const platform of selectedPlatforms) {
  const source = join(binaryDir, `showtell-${platform}`);
  const stageDir = join(releaseDir, `stage-${platform}`);
  const stagedBinary = join(stageDir, "showtell");
  mkdirSync(stageDir, { recursive: true });
  copyFileSync(source, stagedBinary);
  chmodSync(stagedBinary, 0o755);
  const target = releaseTarget(platform)!;
  if (suppliedBinaryDir) {
    extractBrowserArchive(target, suppliedBinaryDir, stageDir);
  } else {
    stageInstalledBrowser(target, stageDir);
    writeBrowserArchive(target, stageDir, binaryDir);
  }
  cpSync(playerDir, join(stageDir, "player"), { recursive: true });
  const legalDir = join(stageDir, "showtell-legal");
  mkdirSync(legalDir, { recursive: true });
  copyFileSync(join(root, "LICENSE"), join(legalDir, "LICENSE"));
  copyFileSync(join(root, "NOTICE"), join(legalDir, "NOTICE"));
  const tarName = `showtell-v${version}-${platform}.tar.gz`;
  run(["tar", "-czf", join(releaseDir, tarName), "-C", stageDir, "showtell", "browser", "player", "showtell-legal"]);
  rmSync(stageDir, { recursive: true, force: true });
  artifacts.push(tarName);
}

const skillTar = `showtell-skill-v${version}.tar.gz`;
run(["tar", "-czf", join(releaseDir, skillTar), "-C", join(root, "skills"), "showtell"]);
artifacts.push(skillTar);

const npmBuildArgs = ["bun", "scripts/build-npm-package.ts", "--skip-player-build"];
if (suppliedBinaryDir) npmBuildArgs.push("--binary-dir", suppliedBinaryDir);
run(npmBuildArgs);

for (const platform of selectedPlatforms) {
  const packageName = `showtell-${platform}`;
  run(["npm", "pack", join(root, "dist", "npm", packageName), "--pack-destination", releaseDir]);
  artifacts.push(`${packageName}-${version}.tgz`);
}
run(["npm", "pack", join(root, "dist", "npm", "showtell"), "--pack-destination", releaseDir]);
artifacts.push(`showtell-${version}.tgz`);

const sums = artifacts
  .map((name) => {
    const digest = createHash("sha256")
      .update(readFileSync(join(releaseDir, name)))
      .digest("hex");
    return `${digest}  ${name}`;
  })
  .join("\n");
writeFileSync(join(releaseDir, "SHA256SUMS"), `${sums}\n`);

process.stdout.write(
  `${JSON.stringify({ ok: true, version, platforms: selectedPlatforms, releaseDir, artifacts: [...artifacts, "SHA256SUMS"] }, null, 2)}\n`,
);
