import { execFileSync } from "node:child_process";

/** Duration of a media file in milliseconds, via ffprobe. */
export function probeDurationMs(path: string): number {
  const out = execFileSync(
    "ffprobe",
    ["-v", "error", "-show_entries", "format=duration", "-of", "default=noprint_wrappers=1:nokey=1", path],
    { encoding: "utf-8" },
  );
  const secs = parseFloat(out.trim());
  if (!Number.isFinite(secs)) throw new Error(`Could not read duration of ${path}`);
  return Math.round(secs * 1000);
}
