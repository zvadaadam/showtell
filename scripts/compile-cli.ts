#!/usr/bin/env bun
/** Compile the Showtell CLI with the one policy shared by local, npm, and release builds. */
import { mkdirSync } from "node:fs";
import { dirname, isAbsolute, join, resolve } from "node:path";

const root = join(import.meta.dir, "..");

/**
 * playwright-core resolves its own package.json at module load through a
 * runtime-computed path (`require(path.join(__dirname, "..", "package.json"))`
 * in lib/package.js and again inline in lib/serverRegistry.js). Under
 * `bun build --compile`, `__dirname` bakes to the BUILD machine's absolute
 * store path, so the standalone binary crashes on every other machine with
 * "Cannot find module .../playwright-core/package.json". Rewrite the pattern
 * to a static specifier the bundler can embed.
 */
const playwrightCoreStaticPackageJson: import("bun").BunPlugin = {
  name: "playwright-core-static-package-json",
  setup(build) {
    const selfJsonRequire = /require\(import_path\d*\.default\.join\(packageRoot, "([\w.-]+\.json)"\)\)/g;
    build.onLoad({ filter: /playwright-core[\\/]lib[\\/].*\.js$/ }, async (args) => {
      const source = await Bun.file(args.path).text();
      const packageDir = args.path.replace(/[\\/]lib[\\/][^]*$/, "");
      const names = new Set([...source.matchAll(selfJsonRequire)].map((match) => match[1]!));
      let contents = source;
      for (const name of names) {
        const file = Bun.file(join(packageDir, name));
        // Files absent from the shipped package (e.g. api.json) sit on lazy,
        // never-taken paths; keep them lazily failing instead of baking paths.
        const literal = (await file.exists())
          ? `(${await file.text()})`
          : `(() => { throw new Error("playwright-core ${name} is not part of the compiled Showtell binary."); })()`;
        const needle = new RegExp(
          `require\\(import_path\\d*\\.default\\.join\\(packageRoot, "${name.replaceAll(".", "\\.")}"\\)\\)`,
          "g",
        );
        contents = contents.replace(needle, () => literal);
      }
      return { contents, loader: "js" };
    });
  },
};

export async function compileCli(outfileInput: string, target?: string): Promise<string> {
  const outfile = isAbsolute(outfileInput) ? outfileInput : resolve(root, outfileInput);
  mkdirSync(dirname(outfile), { recursive: true });
  const result = await Bun.build({
    entrypoints: [join(root, "packages/cli/src/index.ts")],
    compile: { outfile, ...(target ? { target } : {}) },
    external: ["chromium-bidi/*"],
    plugins: [playwrightCoreStaticPackageJson],
    throw: false,
  });
  if (!result.success) {
    const detail = result.logs.map((log) => String(log.message ?? log)).join("\n");
    throw new Error(`bun build --compile failed for ${outfile}:\n${detail}`);
  }
  return outfile;
}

if (import.meta.main) {
  const args = process.argv.slice(2);
  const valueAfter = (flag: string): string | undefined => {
    const index = args.indexOf(flag);
    return index === -1 ? undefined : args[index + 1];
  };
  const outfile = valueAfter("--outfile") ?? "dist/showtell";
  const path = await compileCli(outfile, valueAfter("--target"));
  process.stdout.write(`${JSON.stringify({ ok: true, stage: "compile-cli", path }, null, 2)}\n`);
}
