#!/usr/bin/env bun
/** Stage the public Showtell npm launcher and one or more native binary packages. */
import { chmodSync, copyFileSync, cpSync, existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { RELEASE_TARGETS, releaseTarget, type PlatformId, type ReleaseTarget } from "./release-targets.ts";
import { extractBrowserArchive, stageInstalledBrowser, writeBrowserArchive } from "./browser-bundle.ts";
import { compileCli } from "./compile-cli.ts";

const root = join(import.meta.dir, "..");
const npmDir = join(root, "dist", "npm");
const playerDir = join(root, "packages", "player", "dist", "client");
const rootManifest = JSON.parse(readFileSync(join(root, "package.json"), "utf-8")) as { version: string };
const args = process.argv.slice(2);

function valueAfter(flag: string): string | undefined {
  const index = args.indexOf(flag);
  return index === -1 ? undefined : args[index + 1];
}

function run(command: string[]): void {
  const result = Bun.spawnSync(command, { cwd: root, stdout: "inherit", stderr: "inherit" });
  if (result.exitCode !== 0) throw new Error(`Command failed (${result.exitCode}): ${command.join(" ")}`);
}

function sharedManifest(name: string, description: string): Record<string, unknown> {
  return {
    name,
    version: rootManifest.version,
    description,
    license: "MIT",
    homepage: "https://github.com/zvadaadam/showtell#readme",
    repository: { type: "git", url: "git+https://github.com/zvadaadam/showtell.git" },
    bugs: { url: "https://github.com/zvadaadam/showtell/issues" },
    publishConfig: { access: "public", registry: "https://registry.npmjs.org/" },
  };
}

function writeManifest(dir: string, manifest: Record<string, unknown>): void {
  writeFileSync(join(dir, "package.json"), `${JSON.stringify(manifest, null, 2)}\n`);
}

function stageRootPackage(): string {
  const stageDir = join(npmDir, "showtell");
  const binDir = join(stageDir, "bin");
  mkdirSync(binDir, { recursive: true });
  copyFileSync(join(root, "scripts", "npm-launcher.cjs"), join(binDir, "showtell.cjs"));
  chmodSync(join(binDir, "showtell.cjs"), 0o755);
  copyFileSync(join(root, "LICENSE"), join(stageDir, "LICENSE"));
  copyFileSync(join(root, "NOTICE"), join(stageDir, "NOTICE"));
  writeFileSync(join(stageDir, "README.md"), npmReadme());
  writeManifest(stageDir, {
    ...sharedManifest("showtell", "Open-source motion engine for videos made by agents, for humans."),
    bin: { showtell: "bin/showtell.cjs" },
    files: ["bin/showtell.cjs", "README.md", "LICENSE", "NOTICE"],
    keywords: ["ai", "agent", "video", "motion", "renderer", "cli", "bun"],
    engines: { node: ">=18" },
    optionalDependencies: Object.fromEntries(
      RELEASE_TARGETS.map((target) => [target.packageName, rootManifest.version]),
    ),
  });
  return stageDir;
}

function stagePlatformPackage(target: ReleaseTarget, binarySource: string, browserArchiveDir?: string): string {
  if (!existsSync(binarySource)) throw new Error(`Missing ${target.id} binary: ${binarySource}`);
  if (!existsSync(join(playerDir, "_shell.html"))) throw new Error(`Missing built player: ${playerDir}`);
  const stageDir = join(npmDir, target.packageName);
  const binDir = join(stageDir, "bin");
  mkdirSync(binDir, { recursive: true });
  copyFileSync(binarySource, join(binDir, "showtell"));
  chmodSync(join(binDir, "showtell"), 0o755);
  if (browserArchiveDir) {
    extractBrowserArchive(target, browserArchiveDir, stageDir);
  } else {
    stageInstalledBrowser(target, stageDir);
    writeBrowserArchive(target, stageDir, join(root, "dist", "bin"));
  }
  copyFileSync(join(root, "LICENSE"), join(stageDir, "LICENSE"));
  copyFileSync(join(root, "NOTICE"), join(stageDir, "NOTICE"));
  cpSync(playerDir, join(stageDir, "player"), { recursive: true });
  writeManifest(stageDir, {
    ...sharedManifest(target.packageName, `Showtell native binary for ${target.id}.`),
    os: [target.os],
    cpu: [target.cpu],
    ...(target.libc ? { libc: [target.libc] } : {}),
    files: ["bin/showtell", "browser", "player", "LICENSE", "NOTICE"],
  });
  return stageDir;
}

async function compile(target: ReleaseTarget): Promise<string> {
  const binaryDir = join(root, "dist", "bin");
  const binary = join(binaryDir, `showtell-${target.id}`);
  return await compileCli(binary, target.bunTarget);
}

function hostTarget(): ReleaseTarget {
  const id = `${process.platform}-${process.arch}`;
  const target = releaseTarget(id);
  if (!target) throw new Error(`Unsupported build host ${id}. Pass --target and --binary, or --binary-dir.`);
  return target;
}

function npmReadme(): string {
  return `# showtell

**Agents don't just tell. They show.**

Showtell is an open-source motion engine for videos made by agents, for humans. Agents author structured intent and deterministic browser HyperFrames in HTML, CSS, and JavaScript; Showtell renders narrated MP4s from code, diffs, data, maps, screenshots, images, and other declared inputs.

## Install

\`\`\`sh
npm install --global showtell
showtell version
\`\`\`

Showtell supports Apple Silicon macOS and glibc-based Linux on x64 or ARM64. It installs one self-contained native binary plus the pinned Chromium runtime for your platform; Bun and a separate browser install are not required. Rendering requires [ffmpeg](https://ffmpeg.org/).

macOS:

\`\`\`sh
brew install ffmpeg
\`\`\`

Ubuntu/Debian:

\`\`\`sh
sudo apt-get update && sudo apt-get install -y ffmpeg espeak-ng
\`\`\`

## Quick start

Install the bundled agent skill:

\`\`\`sh
showtell skill install
# Codex: showtell skill install --dir ~/.codex/skills
\`\`\`

Then ask your agent: **“Make me a showtell of this PR.”**

The source, examples, and complete documentation live in the [Showtell repository](https://github.com/zvadaadam/showtell).

## Linux note

The default local \`say\` provider uses \`espeak-ng\` on Linux. OpenAI, Replicate, and ElevenLabs are also available through environment API keys. Screen recording is currently macOS-only; rendering existing screenshots and screencap files works on Linux.

## License

MIT
`;
}

rmSync(npmDir, { recursive: true, force: true });
mkdirSync(npmDir, { recursive: true });
if (!args.includes("--skip-player-build")) run(["bun", "run", "build:player"]);
const staged = [stageRootPackage()];
const binaryDir = valueAfter("--binary-dir");
const targetId = valueAfter("--target") as PlatformId | undefined;
const suppliedBinary = valueAfter("--binary");

if (binaryDir) {
  for (const target of RELEASE_TARGETS) {
    staged.push(stagePlatformPackage(target, join(binaryDir, `showtell-${target.id}`), binaryDir));
  }
} else {
  const target = targetId ? releaseTarget(targetId) : hostTarget();
  if (!target) {
    throw new Error(`Unknown --target ${targetId}. Valid targets: ${RELEASE_TARGETS.map(({ id }) => id).join(", ")}`);
  }
  if (suppliedBinary && !targetId) throw new Error("--binary requires --target.");
  staged.push(stagePlatformPackage(target, suppliedBinary ?? (await compile(target))));
}

process.stdout.write(`${JSON.stringify({ ok: true, version: rootManifest.version, npmDir, staged }, null, 2)}\n`);
