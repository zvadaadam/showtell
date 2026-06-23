/** Local macOS `say` TTS adapter (no API key, offline). v1a default. */
import { execFileSync } from "node:child_process";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { SynthesizeRequest } from "./types.ts";

export function sayToWav(req: SynthesizeRequest, wavPath: string): void {
  const tmp = mkdtempSync(join(tmpdir(), "av-say-"));
  try {
    const aiff = join(tmp, "out.aiff");
    const args = ["-o", aiff];
    if (req.voice) args.push("-v", req.voice);
    args.push("--", req.text);
    execFileSync("say", args);
    // Normalize to mono 44.1k PCM wav for consistent muxing.
    execFileSync("ffmpeg", ["-y", "-loglevel", "error", "-i", aiff, "-ar", "44100", "-ac", "1", wavPath]);
  } finally {
    rmSync(tmp, { recursive: true, force: true });
  }
}
