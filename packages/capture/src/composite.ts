/** Composite a screen recording into a timeline clip: optionally apply the
 *  auto-zoom camera (a sendcmd-driven crop from the event timeline), then fit to
 *  the target frame (letterbox on the gradient bg), persist to the narration
 *  duration, mux narration audio, overlay the watermark. */
import { execFileSync } from "node:child_process";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { CameraKeyframe } from "./camera.ts";

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
  /** Auto-zoom camera timeline + the recording's source dimensions (optional). */
  camera?: CameraKeyframe[];
  sourceSize?: { width: number; height: number };
}

/** Even-aligned crop rect (source px) for a camera keyframe. */
function cropRect(
  k: CameraKeyframe,
  s: { width: number; height: number },
): { w: number; h: number; x: number; y: number } {
  const w = Math.max(2, Math.round(s.width / k.zoom / 2) * 2);
  const h = Math.max(2, Math.round(s.height / k.zoom / 2) * 2);
  const x = Math.min(s.width - w, Math.max(0, Math.round(k.x - w / 2)));
  const y = Math.min(s.height - h, Math.max(0, Math.round(k.y - h / 2)));
  return { w, h, x, y };
}

export function compositeScreencap(o: CompositeOpts): void {
  const W = o.width;
  const H = o.height;
  const bg = o.bg ?? "0x0f0f23";
  const work = mkdtempSync(join(tmpdir(), "av-cam-"));
  try {
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

    // Optional auto-zoom: a sendcmd-driven crop following the event timeline.
    let camStage = "";
    if (o.camera && o.camera.length > 0 && o.sourceSize) {
      const cmds = o.camera
        .map((k) => {
          const c = cropRect(k, o.sourceSize!);
          return `${(k.t / 1000).toFixed(3)} crop w ${c.w}, crop h ${c.h}, crop x ${c.x}, crop y ${c.y};`;
        })
        .join("\n");
      const cmdFile = join(work, "camera.cmd");
      writeFileSync(cmdFile, cmds);
      const c0 = cropRect(o.camera[0]!, o.sourceSize);
      camStage = `sendcmd=f=${cmdFile},crop=${c0.w}:${c0.h}:${c0.x}:${c0.y},`;
    }

    // Camera crop (optional) → fit into WxH, pad with bg, hold the last frame.
    let vf =
      `[0:v]${camStage}scale=${W}:${H}:force_original_aspect_ratio=decrease,` +
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
  } finally {
    rmSync(work, { recursive: true, force: true });
  }
}
