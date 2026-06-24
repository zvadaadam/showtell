/** Composite a screen recording into a timeline clip: fit to the target frame
 *  (letterbox on the gradient bg), persist to the narration duration, mux
 *  narration audio, overlay the watermark. */
import { execFileSync } from "node:child_process";

export interface CompositeOpts {
  source: string;
  outPath: string;
  width: number;
  height: number;
  durationSec: number;
  fps: number;
  /** Narration wav to mux (optional). */
  audio?: string;
  /** Full-frame transparent watermark PNG to overlay (optional). */
  watermarkPng?: string;
  /** Pad/background color (0xRRGGBB). */
  bg?: string;
}

export function compositeScreencap(o: CompositeOpts): void {
  const W = o.width;
  const H = o.height;
  const bg = o.bg ?? "0x0f0f23";

  const inputs: string[] = ["-i", o.source];
  let nextIdx = 1;
  let audioIdx = -1;
  let wmIdx = -1;
  if (o.audio) {
    inputs.push("-i", o.audio);
    audioIdx = nextIdx++;
  }
  if (o.watermarkPng) {
    inputs.push("-loop", "1", "-i", o.watermarkPng);
    wmIdx = nextIdx++;
  }

  // Fit the recording into WxH, pad with bg, hold the last frame past EOF.
  let vf =
    `[0:v]scale=${W}:${H}:force_original_aspect_ratio=decrease,` +
    `pad=${W}:${H}:(ow-iw)/2:(oh-ih)/2:color=${bg},setsar=1,` +
    `tpad=stop_mode=clone:stop_duration=3600`;
  if (wmIdx >= 0) vf += `[base];[base][${wmIdx}:v]overlay=0:0[v]`;
  else vf += `[v]`;

  const args = ["-y", "-loglevel", "error", ...inputs, "-filter_complex", vf, "-map", "[v]"];
  if (audioIdx >= 0) args.push("-map", `${audioIdx}:a`);
  args.push(
    "-t",
    o.durationSec.toFixed(3),
    "-r",
    String(o.fps),
    "-c:v",
    "libx264",
    "-pix_fmt",
    "yuv420p",
    "-preset",
    "medium",
    "-threads",
    "1",
    "-flags:v",
    "+bitexact",
  );
  if (audioIdx >= 0) {
    args.push("-c:a", "aac", "-b:a", "192k", "-ar", "44100", "-ac", "2", "-flags:a", "+bitexact");
  }
  args.push("-movflags", "+faststart", "-map_metadata", "-1", "-fflags", "+bitexact", o.outPath);

  execFileSync("ffmpeg", args, { stdio: ["ignore", "pipe", "pipe"], maxBuffer: 16 * 1024 * 1024 });
}
