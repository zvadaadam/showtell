/** Local macOS `say` TTS adapter (no API key, offline). v1 default.
 *  Returns raw AIFF; the gateway normalizes to a wav. */
import { execFileSync } from "node:child_process";
import { mkdtempSync, rmSync, readFileSync } from "node:fs";
import { tmpdir, platform } from "node:os";
import { join } from "node:path";
import type { TtsAdapter } from "./types.ts";

export const sayTts: TtsAdapter = async (req) => {
  if (platform() !== "darwin") {
    throw new Error('TTS provider "say" is macOS-only. Use another provider (e.g. "openai") on other platforms.');
  }
  const tmp = mkdtempSync(join(tmpdir(), "av-say-"));
  try {
    const aiff = join(tmp, "out.aiff");
    const args = ["-o", aiff];
    if (req.voice) args.push("-v", req.voice);
    args.push("--", req.text);
    execFileSync("say", args);
    return { data: readFileSync(aiff), format: "aiff" };
  } finally {
    rmSync(tmp, { recursive: true, force: true });
  }
};
