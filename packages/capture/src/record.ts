/**
 * macOS screen recording via ffmpeg avfoundation. Adapted from
 * @deus/screen-studio (MIT). Needs Screen Recording permission
 * (System Settings → Privacy & Security → Screen Recording).
 */
import { execFileSync } from "node:child_process";
import { existsSync, statSync, rmSync } from "node:fs";
import { platform } from "node:os";

/** Auto-detect the "Capture screen N" avfoundation device index. */
function detectScreenDevice(): string | null {
  if (platform() !== "darwin") return null;
  let output = "";
  try {
    output = execFileSync("ffmpeg", ["-f", "avfoundation", "-list_devices", "true", "-i", ""], {
      encoding: "utf-8",
      stdio: ["ignore", "pipe", "pipe"],
      timeout: 5000,
    });
  } catch (e) {
    output = (e as { stderr?: string })?.stderr ?? "";
  }
  for (const line of output.split("\n")) {
    const m = line.match(/\[(\d+)]\s+Capture screen/);
    if (m) return m[1]!;
  }
  return null;
}

export interface RecordOpts {
  outPath: string;
  durationSec: number;
  fps?: number;
  screenDevice?: string;
}

/** Record the screen for a fixed duration (non-interactive, agent-first). */
export function recordScreen(opts: RecordOpts): { outPath: string; bytes: number } {
  if (platform() !== "darwin") {
    throw new Error("Screen capture is macOS-only in v1 (avfoundation).");
  }
  const device = opts.screenDevice ?? detectScreenDevice();
  if (!device) {
    throw new Error(
      'No avfoundation screen device found. Run `ffmpeg -f avfoundation -list_devices true -i ""` to inspect, or grant Screen Recording permission.',
    );
  }
  try {
    execFileSync(
      "ffmpeg",
      [
        "-y",
        "-f",
        "avfoundation",
        "-framerate",
        String(opts.fps ?? 30),
        "-capture_cursor",
        "1",
        "-i",
        `${device}:none`,
        "-t",
        String(opts.durationSec),
        "-c:v",
        "libx264",
        "-preset",
        "ultrafast",
        "-crf",
        "18",
        "-pix_fmt",
        "yuv420p",
        opts.outPath,
      ],
      { stdio: ["ignore", "pipe", "pipe"], timeout: (opts.durationSec + 20) * 1000 },
    );
  } catch (e) {
    rmSync(opts.outPath, { force: true }); // never leave a truncated mp4 a later render would pick up
    throw new Error(
      `Screen recording failed: ${(e as Error).message}. Hint: grant Screen Recording permission in System Settings → Privacy & Security.`,
    );
  }
  if (!existsSync(opts.outPath) || statSync(opts.outPath).size === 0) {
    rmSync(opts.outPath, { force: true });
    throw new Error(
      `Screen recording produced no output (permission denied?). Grant Screen Recording permission and retry.`,
    );
  }
  return { outPath: opts.outPath, bytes: statSync(opts.outPath).size };
}
