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

/** Pixel dimensions of a video file's first stream, via ffprobe. */
export function probeVideoSize(path: string): { width: number; height: number } {
  const out = execFileSync(
    "ffprobe",
    ["-v", "error", "-select_streams", "v:0", "-show_entries", "stream=width,height", "-of", "csv=s=x:p=0", path],
    { encoding: "utf-8" },
  );
  const [w, h] = out.trim().split("x").map(Number);
  if (!w || !h) throw new Error(`Could not read video size of ${path}`);
  return { width: w, height: h };
}
