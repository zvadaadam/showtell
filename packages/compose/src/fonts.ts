/**
 * Register the pinned fonts (fontsource, locked via the lockfile = deterministic).
 *
 * The .woff2 files are imported as bundled assets (`with { type: "file" }`) so they
 * survive `bun build --compile` — a standalone binary has no node_modules, so the
 * old `require.resolve` approach silently fell back to a system face. We register
 * from the embedded bytes and warn loudly (to stderr) on any miss, since a missing
 * pinned font is a packaging bug, not an expected fallback.
 */
import { GlobalFonts } from "@napi-rs/canvas";
import { readFileSync } from "node:fs";
import jetbrainsMono from "@fontsource/jetbrains-mono/files/jetbrains-mono-latin-400-normal.woff2" with { type: "file" };
import inter400 from "@fontsource/inter/files/inter-latin-400-normal.woff2" with { type: "file" };
import inter500 from "@fontsource/inter/files/inter-latin-500-normal.woff2" with { type: "file" };
import inter600 from "@fontsource/inter/files/inter-latin-600-normal.woff2" with { type: "file" };
import inter700 from "@fontsource/inter/files/inter-latin-700-normal.woff2" with { type: "file" };
import interGreek400 from "@fontsource/inter/files/inter-greek-400-normal.woff2" with { type: "file" };
import interGreek500 from "@fontsource/inter/files/inter-greek-500-normal.woff2" with { type: "file" };
import interGreek600 from "@fontsource/inter/files/inter-greek-600-normal.woff2" with { type: "file" };
import interGreek700 from "@fontsource/inter/files/inter-greek-700-normal.woff2" with { type: "file" };
import notoSansMath from "@fontsource/noto-sans-math/files/noto-sans-math-latin-400-normal.woff2" with { type: "file" };

/**
 * Greek subsets register as "<Alias> Greek" families: skia does not merge
 * coverage across same-alias registrations, so text renderers use font STACKS
 * ("Inter Bold", "Inter Bold Greek", "JetBrains Mono") — Greek letters resolve
 * from the twin face and stray math operators from the mono face instead of
 * nondeterministic system fallback or tofu.
 */
const FACES: ReadonlyArray<readonly [path: string, alias: string]> = [
  [jetbrainsMono, "JetBrains Mono"],
  [inter400, "Inter"],
  [inter500, "Inter Medium"],
  [inter600, "Inter SemiBold"],
  [inter700, "Inter Bold"],
  [interGreek400, "Inter Greek"],
  [interGreek500, "Inter Medium Greek"],
  [interGreek600, "Inter SemiBold Greek"],
  [interGreek700, "Inter Bold Greek"],
  [notoSansMath, "Noto Sans Math"],
];

let registered = false;

export function ensureFonts(): void {
  if (registered) return;
  const missed: string[] = [];
  for (const [path, alias] of FACES) {
    try {
      if (!GlobalFonts.register(readFileSync(path), alias)) missed.push(alias);
    } catch {
      missed.push(alias);
    }
  }
  if (missed.length > 0) {
    process.stderr.write(
      `[agent-video] WARNING: could not register pinned font(s): ${missed.join(", ")}. ` +
        `Renders will use a fallback face — this is a packaging bug.\n`,
    );
  }
  registered = true;
}
