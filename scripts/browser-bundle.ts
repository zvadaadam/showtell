import { existsSync, cpSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { basename, dirname, isAbsolute, join, relative, resolve, sep } from "node:path";
import { chromium } from "playwright";
import { webRuntimeIdentity } from "../packages/render/src/web-authoring.ts";
import { headlessShellExecutable } from "../packages/render/src/chromium-path.ts";
import type { ReleaseTarget } from "./release-targets.ts";

export const browserArchiveName = (target: ReleaseTarget): string => `showtell-${target.id}-browser.tar.gz`;

function run(command: string[]): void {
  const result = Bun.spawnSync(command, { stdout: "inherit", stderr: "inherit" });
  if (result.exitCode !== 0) throw new Error(`Command failed (${result.exitCode}): ${command.join(" ")}`);
}

function runText(command: string[]): string {
  const result = Bun.spawnSync(command, { stdout: "pipe", stderr: "pipe" });
  if (result.exitCode !== 0) {
    throw new Error(`Command failed (${result.exitCode}): ${command.join(" ")}\n${result.stderr.toString()}`);
  }
  return result.stdout.toString();
}

/** Reject archives that can write anywhere except their browser/ subtree. */
export function assertBrowserArchiveEntries(entries: readonly string[]): void {
  for (const rawEntry of entries) {
    const entry = rawEntry.replaceAll("\\", "/").replace(/^\.\//, "").replace(/\/$/, "");
    const segments = entry.split("/");
    if (
      !entry ||
      isAbsolute(entry) ||
      (entry !== "browser" && !entry.startsWith("browser/")) ||
      segments.includes("..")
    ) {
      throw new Error(`Unsafe browser archive entry: ${rawEntry}`);
    }
  }
}

function hostMatches(target: ReleaseTarget): boolean {
  return target.os === process.platform && target.cpu === process.arch;
}

function chromiumRoot(executable: string): string {
  let current = dirname(executable);
  const expected = `chromium_headless_shell-${webRuntimeIdentity.chromiumRevision}`;
  while (dirname(current) !== current) {
    if (basename(current) === expected) return current;
    current = dirname(current);
  }
  throw new Error(`Playwright executable is not inside the pinned ${expected} directory: ${executable}`);
}

function ensureInstalledChromium(): string {
  let executable = headlessShellExecutable(chromium.executablePath(), webRuntimeIdentity.chromiumRevision);
  if (!existsSync(executable)) {
    run(["bunx", "playwright", "install", "chromium"]);
    executable = headlessShellExecutable(chromium.executablePath(), webRuntimeIdentity.chromiumRevision);
  }
  if (!existsSync(executable)) throw new Error(`Pinned Chromium executable was not installed: ${executable}`);
  return executable;
}

/** Copy the host's exact pinned Playwright browser into a release stage. */
export function stageInstalledBrowser(target: ReleaseTarget, stageDir: string): string {
  if (!hostMatches(target)) {
    throw new Error(
      `Cannot stage a ${target.id} browser from ${process.platform}-${process.arch}. ` +
        `Build on the target host or pass a ${browserArchiveName(target)} artifact.`,
    );
  }
  const executable = ensureInstalledChromium();
  const sourceRoot = chromiumRoot(executable);
  const browserDir = join(stageDir, "browser");
  const stagedRoot = join(browserDir, basename(sourceRoot));
  mkdirSync(browserDir, { recursive: true });
  cpSync(sourceRoot, stagedRoot, { recursive: true });
  writeFileSync(
    join(browserDir, "runtime.json"),
    `${JSON.stringify(
      {
        ...webRuntimeIdentity,
        executable: join(basename(sourceRoot), relative(sourceRoot, executable)).replaceAll("\\", "/"),
      },
      null,
      2,
    )}\n`,
  );
  return browserDir;
}

export function writeBrowserArchive(target: ReleaseTarget, stageDir: string, outDir: string): string {
  const archive = join(outDir, browserArchiveName(target));
  mkdirSync(outDir, { recursive: true });
  run(["tar", "-czf", archive, "-C", stageDir, "browser"]);
  return archive;
}

export function extractBrowserArchive(target: ReleaseTarget, archiveDir: string, stageDir: string): string {
  const archive = join(archiveDir, browserArchiveName(target));
  if (!existsSync(archive)) throw new Error(`Missing ${target.id} browser archive: ${archive}`);
  const entries = runText(["tar", "-tzf", archive]).split("\n").filter(Boolean);
  assertBrowserArchiveEntries(entries);
  run(["tar", "-xzf", archive, "-C", stageDir]);
  const manifest = join(stageDir, "browser", "runtime.json");
  if (!existsSync(manifest)) throw new Error(`Browser archive did not contain browser/runtime.json: ${archive}`);
  const runtime = JSON.parse(readFileSync(manifest, "utf-8")) as { chromiumRevision?: string; executable?: string };
  if (runtime.chromiumRevision !== webRuntimeIdentity.chromiumRevision || !runtime.executable) {
    throw new Error(
      `Browser archive runtime identity does not match pinned Chromium ${webRuntimeIdentity.chromiumRevision}.`,
    );
  }
  const browserRoot = resolve(stageDir, "browser");
  const executable = resolve(browserRoot, runtime.executable);
  if (executable !== browserRoot && !executable.startsWith(`${browserRoot}${sep}`)) {
    throw new Error(`Browser archive executable escapes its browser directory: ${runtime.executable}`);
  }
  if (!existsSync(executable)) throw new Error(`Browser archive executable is missing: ${executable}`);
  return browserRoot;
}
