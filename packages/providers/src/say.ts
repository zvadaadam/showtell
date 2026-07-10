/** Local system TTS adapter (no API key, offline). v1 default.
 * macOS uses `say`; Linux uses `espeak-ng` (or `espeak`). */
import { execFileSync } from "node:child_process";
import { mkdtempSync, rmSync, readFileSync } from "node:fs";
import { tmpdir, platform } from "node:os";
import { join } from "node:path";
import type { TtsAdapter } from "./types.ts";

export const sayTts: TtsAdapter = async (req) => {
  const tmp = mkdtempSync(join(tmpdir(), "av-say-"));
  try {
    if (platform() === "darwin") {
      const aiff = join(tmp, "out.aiff");
      const args = ["-o", aiff];
      if (req.voice) args.push("-v", req.voice);
      args.push("--", req.text);
      execFileSync("say", args);
      return { data: readFileSync(aiff), format: "aiff" };
    }

    if (platform() === "linux") {
      const engine = Bun.which("espeak-ng") ?? Bun.which("espeak");
      if (!engine) {
        throw new Error('TTS provider "say" needs espeak-ng on Linux. Install it with: sudo apt-get install espeak-ng');
      }
      const wav = join(tmp, "out.wav");
      const args = ["-w", wav];
      if (req.voice) args.push("-v", req.voice);
      execFileSync(engine, args, { input: req.text });
      return { data: readFileSync(wav), format: "wav" };
    }

    throw new Error('TTS provider "say" supports macOS and Linux. Use a remote provider on this platform.');
  } finally {
    rmSync(tmp, { recursive: true, force: true });
  }
};
