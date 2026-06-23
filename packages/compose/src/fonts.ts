/** Register bundled fonts (fontsource, pinned via lockfile = deterministic). */
import { GlobalFonts } from "@napi-rs/canvas";
import { createRequire } from "node:module";

const require = createRequire(import.meta.url);
let registered = false;

function reg(spec: string, alias: string): void {
  try {
    GlobalFonts.registerFromPath(require.resolve(spec), alias);
  } catch {
    // Best-effort: canvas falls back to a default face if a weight is missing.
  }
}

export function ensureFonts(): void {
  if (registered) return;
  reg("@fontsource/jetbrains-mono/files/jetbrains-mono-latin-400-normal.woff2", "JetBrains Mono");
  reg("@fontsource/inter/files/inter-latin-400-normal.woff2", "Inter");
  reg("@fontsource/inter/files/inter-latin-700-normal.woff2", "Inter Bold");
  registered = true;
}
