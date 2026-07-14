/** Composite a screen recording into a timeline clip: optionally apply the
 *  auto-zoom camera (a sendcmd-driven crop from the event timeline), then fit to
 *  the target frame (letterbox on the gradient bg), persist to the narration
 *  duration, mux narration audio, overlay the watermark. */
import { execFileSync } from "node:child_process";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { CameraKeyframe, CaptureEvent } from "./camera.ts";
import {
  DETERMINISTIC_AUDIO_ARGS,
  DETERMINISTIC_CONTAINER_ARGS,
  DETERMINISTIC_VIDEO_ARGS,
  FASTSTART_ARGS,
} from "./encode.ts";
import type { PlaybackPlan } from "./playback.ts";

export interface ScreencapOverlay {
  /** Full-frame transparent PNG, sized to the output dimensions. */
  png: string;
  /** Show only from this output-clip time (seconds); omit to show from the start. */
  enableStartSec?: number;
  /** Hide after this output-clip time (seconds); omit to show until the end. */
  enableEndSec?: number;
}

export interface CompositeOpts {
  source: string;
  /** Start reading the source recording at this offset. */
  sourceStartSec?: number;
  /** Stop reading the source recording after this many seconds, then hold last frame if needed. */
  sourceDurationSec?: number;
  outPath: string;
  width: number;
  height: number;
  durationSec: number;
  fps: number;
  /** Narration wav to mux (optional). */
  audio?: string;
  /** Full-frame transparent chrome overlays (watermark, captions, presenter), composited in order. */
  overlays?: ScreencapOverlay[];
  /** Pad/background color (0xRRGGBB). */
  bg?: string;
  /** Auto-zoom camera timeline + the recording's source dimensions (optional). */
  camera?: CameraKeyframe[];
  sourceSize?: { width: number; height: number };
  /** Optional source→output timing plan used to cut dead air and speed up gaps. */
  playbackPlan?: PlaybackPlan;
  /** Optional action feedback overlays, already remapped to the output timeline. */
  actionEffects?: CaptureEvent[];
}

/** Even-aligned crop rect (source px) for a camera keyframe. */
function cropRect(
  k: CameraKeyframe,
  s: { width: number; height: number },
): { w: number; h: number; x: number; y: number } {
  const w = evenFloorAtMost(s.width / k.zoom, s.width);
  const h = evenFloorAtMost(s.height / k.zoom, s.height);
  const x = Math.min(s.width - w, Math.max(0, Math.round(k.x - w / 2)));
  const y = Math.min(s.height - h, Math.max(0, Math.round(k.y - h / 2)));
  return { w, h, x, y };
}

function evenFloorAtMost(value: number, max: number): number {
  const capped = Math.min(value, max);
  const floored = Math.floor(capped);
  const even = floored % 2 === 0 ? floored : floored - 1;
  return Math.max(2, even);
}

function playbackFilter(plan: PlaybackPlan | undefined, fps: number): { prefix: string; sourceLabel: string } {
  if (!plan || plan.segments.length === 0) return { prefix: "", sourceLabel: "[0:v]" };

  const safeFps = Math.max(1, Math.round(fps));
  const inputs = plan.segments.length === 1 ? ["[fpsv]"] : plan.segments.map((_, i) => `[src${i}]`);
  const filters = plan.segments.map((seg, i) => {
    const start = (seg.sourceStartMs / 1000).toFixed(3);
    const end = (seg.sourceEndMs / 1000).toFixed(3);
    const rate = Math.max(seg.playbackRate, 0.001).toFixed(6);
    return `${inputs[i]}trim=start=${start}:end=${end},setpts=(PTS-STARTPTS)/${rate}[seg${i}]`;
  });

  if (plan.segments.length === 1) {
    filters.unshift(`[0:v]fps=${safeFps}[fpsv]`);
    return { prefix: filters.join(";"), sourceLabel: "[seg0]" };
  }

  filters.unshift(`[0:v]fps=${safeFps},split=${plan.segments.length}${inputs.join("")}`);
  const labels = plan.segments.map((_, i) => `[seg${i}]`).join("");
  filters.push(`${labels}concat=n=${plan.segments.length}:v=1:a=0[srcv]`);
  return { prefix: filters.join(";"), sourceLabel: "[srcv]" };
}

function actionEffectsFilter(events: CaptureEvent[] | undefined): string {
  if (!events || events.length === 0) return "";
  return events.flatMap((event) => effectFilters(event)).join(",");
}

function effectFilters(event: CaptureEvent): string[] {
  if (event.type !== "click" && event.type !== "type") return [];
  const start = Math.max(0, event.t / 1000 - 0.04);
  const end = start + (event.type === "type" ? 0.7 : 0.42);
  const enable = `enable='between(t,${start.toFixed(3)},${end.toFixed(3)})'`;
  return event.type === "type" ? typePulseFilters(event, enable) : tapGlowFilters(event, enable);
}

function tapGlowFilters(event: CaptureEvent, enable: string): string[] {
  const x = Math.round(event.x);
  const y = Math.round(event.y);
  return [
    drawBox(x - 66, y - 66, 132, 132, "0xf8cf5a@0.16", "fill", enable),
    drawBox(x - 48, y - 48, 96, 96, "0xf8cf5a@0.64", 5, enable),
    drawBox(x - 12, y - 12, 24, 24, "0xf8cf5a@0.70", "fill", enable),
  ];
}

function typePulseFilters(event: CaptureEvent, enable: string): string[] {
  const x = Math.round(event.x);
  const y = Math.round(event.y);
  return [
    drawBox(x - 190, y - 54, 380, 108, "0x2d6cdf@0.18", "fill", enable),
    drawBox(x - 190, y - 54, 380, 108, "0xf8cf5a@0.78", 5, enable),
  ];
}

function drawBox(
  x: number,
  y: number,
  w: number,
  h: number,
  color: string,
  thickness: number | "fill",
  enable: string,
): string {
  return `drawbox=x=${Math.max(0, x)}:y=${Math.max(0, y)}:w=${w}:h=${h}:color=${color}:t=${thickness}:${enable}`;
}

export function compositeScreencap(o: CompositeOpts): void {
  const W = o.width;
  const H = o.height;
  const bg = o.bg ?? "0x0f0f23";
  const work = mkdtempSync(join(tmpdir(), "av-cam-"));
  try {
    const inputs: string[] = [];
    if (o.sourceStartSec && o.sourceStartSec > 0) inputs.push("-ss", o.sourceStartSec.toFixed(3));
    if (o.sourceDurationSec && o.sourceDurationSec > 0) inputs.push("-t", o.sourceDurationSec.toFixed(3));
    inputs.push("-i", o.source);
    let nextIdx = 1;
    let audioIdx = -1;
    if (o.audio) {
      inputs.push("-i", o.audio);
      audioIdx = nextIdx++;
    }
    const overlays = o.overlays ?? [];
    const overlayInputIdx = overlays.map((overlay) => {
      inputs.push("-loop", "1", "-i", overlay.png);
      return nextIdx++;
    });

    // Optional auto-zoom: a sendcmd-driven crop following the event timeline.
    let camStage = "";
    if (o.camera && o.camera.length > 0 && o.sourceSize) {
      const camera = [...o.camera].sort((a, b) => a.t - b.t);
      const cmds = camera
        .map((k) => {
          const c = cropRect(k, o.sourceSize!);
          return `${(k.t / 1000).toFixed(3)} crop w ${c.w}, crop h ${c.h}, crop x ${c.x}, crop y ${c.y};`;
        })
        .join("\n");
      const cmdFile = join(work, "camera.cmd");
      writeFileSync(cmdFile, cmds);
      const c0 = cropRect(camera[0]!, o.sourceSize);
      camStage = `sendcmd=f=${cmdFile},crop=${c0.w}:${c0.h}:${c0.x}:${c0.y},`;
    }

    const played = playbackFilter(o.playbackPlan, o.fps);
    const effectsStage = actionEffectsFilter(o.actionEffects);

    // Playback trim/speed (optional) → camera crop (optional) → fit into WxH,
    // pad with bg, hold the last frame.
    let vf =
      `${played.prefix ? `${played.prefix};` : ""}${played.sourceLabel}` +
      `${effectsStage ? `${effectsStage},` : ""}` +
      `${camStage}` +
      `scale=${W}:${H}:force_original_aspect_ratio=decrease,` +
      `pad=${W}:${H}:(ow-iw)/2:(oh-ih)/2:color=${bg},setsar=1,` +
      `tpad=stop_mode=clone:stop_duration=3600`;
    if (overlays.length > 0) {
      vf += `[base]`;
      let current = "[base]";
      overlays.forEach((overlay, index) => {
        const out = index === overlays.length - 1 ? "[v]" : `[ov${index}]`;
        const windowed = overlay.enableStartSec !== undefined || overlay.enableEndSec !== undefined;
        const enable = windowed
          ? `:enable='between(t,${(overlay.enableStartSec ?? 0).toFixed(3)},${(overlay.enableEndSec ?? o.durationSec).toFixed(3)})'`
          : "";
        vf += `;${current}[${overlayInputIdx[index]}:v]overlay=0:0${enable}${out}`;
        current = out;
      });
    } else vf += `[v]`;

    const args = ["-y", "-loglevel", "error", ...inputs, "-filter_complex", vf, "-map", "[v]"];
    if (audioIdx >= 0) args.push("-map", `${audioIdx}:a`);
    args.push("-t", o.durationSec.toFixed(3), "-r", String(o.fps), ...DETERMINISTIC_VIDEO_ARGS);
    if (audioIdx >= 0) {
      args.push(...DETERMINISTIC_AUDIO_ARGS);
    }
    args.push(...FASTSTART_ARGS, ...DETERMINISTIC_CONTAINER_ARGS, o.outPath);

    execFileSync("ffmpeg", args, { stdio: ["ignore", "pipe", "pipe"], maxBuffer: 16 * 1024 * 1024 });
  } finally {
    rmSync(work, { recursive: true, force: true });
  }
}
