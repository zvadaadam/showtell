import { synthesize } from "../../src/index.ts";

const [, , text, cacheDir] = process.argv;

if (!text || !cacheDir) {
  console.error("Usage: bun run-synthesize.ts <text> <cacheDir>");
  process.exit(2);
}

try {
  await synthesize({ text }, { cacheDir });
  process.exit(0);
} catch (e) {
  console.error(e instanceof Error ? e.message : String(e));
  process.exit(1);
}
