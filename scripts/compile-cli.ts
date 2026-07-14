#!/usr/bin/env bun
/** Compile the Showtell CLI with the one policy shared by local, npm, and release builds. */
import { mkdirSync } from "node:fs";
import { dirname, isAbsolute, join, resolve } from "node:path";

const root = join(import.meta.dir, "..");

export function compileCli(outfileInput: string, target?: string): string {
  const outfile = isAbsolute(outfileInput) ? outfileInput : resolve(root, outfileInput);
  mkdirSync(dirname(outfile), { recursive: true });
  const command = [
    "bun",
    "build",
    "packages/cli/src/index.ts",
    "--compile",
    "--external",
    "chromium-bidi/*",
    ...(target ? [`--target=${target}`] : []),
    "--outfile",
    outfile,
  ];
  const result = Bun.spawnSync(command, { cwd: root, stdout: "inherit", stderr: "inherit" });
  if (result.exitCode !== 0) throw new Error(`Command failed (${result.exitCode}): ${command.join(" ")}`);
  return outfile;
}

if (import.meta.main) {
  const args = process.argv.slice(2);
  const valueAfter = (flag: string): string | undefined => {
    const index = args.indexOf(flag);
    return index === -1 ? undefined : args[index + 1];
  };
  const outfile = valueAfter("--outfile") ?? "dist/showtell";
  const path = compileCli(outfile, valueAfter("--target"));
  process.stdout.write(`${JSON.stringify({ ok: true, stage: "compile-cli", path }, null, 2)}\n`);
}
