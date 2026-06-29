/**
 * Render orchestrator. v1a stage: spec → still PNG frames per scene per aspect
 * ratio (silent). Next stages add TTS, two-pass `auto` durations, and the
 * ffmpeg mux to mp4.
 */
import { mkdirSync, writeFileSync, copyFileSync, rmSync } from "node:fs";
import { join } from "node:path";
import { createHash } from "node:crypto";
import type { VideoSpec, AspectRatio, VideoManifest } from "@agent-video/core";
import { buildManifest, readRepoMeta } from "@agent-video/core";
import { renderSceneToPng, renderWatermarkPng, dimsFor, COMPOSABLE_KINDS } from "@agent-video/compose";
import { synthesize, probeDurationMs, probeVideoSize } from "@agent-video/providers";
import { resolveSession, compositeScreencap, loadSessionEvents, computeCameraTimeline } from "@agent-video/capture";
import { imageAudioToClip, concatClips } from "./ffmpeg.ts";

export { probeDurationMs } from "@agent-video/providers";
export { startPreviewServer, resolvePlayerDist, type PreviewHandle } from "./preview.ts";

function isComposable(kind: string): boolean {
  return (COMPOSABLE_KINDS as readonly string[]).includes(kind);
}

/** Scene kinds the renderer can turn into a clip (compose stills + capture video). */
function isRenderable(kind: string): boolean {
  return isComposable(kind) || kind === "screencap";
}

/** Honest reason a scene has no still frame in `--frames-only` mode. */
function framesOnlySkipReason(kind: string): string {
  const composable = (COMPOSABLE_KINDS as readonly string[]).join(", ");
  return kind === "screencap"
    ? "screencap is video-only (no still frame); it renders in full `render`, not `--frames-only`."
    : `"${kind}" is not a still-composable kind (composable: ${composable}).`;
}

function sha256(text: string): string {
  return createHash("sha256").update(text).digest("hex");
}

export interface FrameInfo {
  scene: number;
  kind: string;
  aspectRatio: AspectRatio;
  path: string;
  width: number;
  height: number;
}

export interface ResolvedInfo {
  scene: number;
  file: string;
  bytes: number;
  sha256: string;
}

export interface RenderFramesResult {
  outDir: string;
  aspectRatios: AspectRatio[];
  frames: FrameInfo[];
  /** For code scenes: the exact live bytes rendered (proves refs-not-pasted). */
  resolvedCode: ResolvedInfo[];
  skipped: { scene: number; kind: string; reason: string }[];
  warnings: { scene: number; message: string }[];
}

function watermarkText(spec: VideoSpec): string | false {
  const w = spec.meta.watermark;
  if (w === false) return false;
  return typeof w === "string" ? w : "agent-video.dev";
}

/**
 * Collect the per-scene metadata that's the same for every aspect ratio: the
 * live-bytes proof (resolvedCode, sha256 of what was rendered) and any warning.
 * Call once per scene (on the first ratio). Shared by renderFrames + renderVideo
 * so the sha/warning logic lives in exactly one place.
 */
function recordSceneMeta(
  rendered: { resolved?: { file: string; text: string }; warning?: string },
  sceneIdx: number,
  out: { resolvedCode: ResolvedInfo[]; warnings: { scene: number; message: string }[] },
): void {
  if (rendered.resolved) {
    out.resolvedCode.push({
      scene: sceneIdx,
      file: rendered.resolved.file,
      bytes: Buffer.byteLength(rendered.resolved.text),
      sha256: sha256(rendered.resolved.text),
    });
  }
  if (rendered.warning) out.warnings.push({ scene: sceneIdx, message: rendered.warning });
}

export async function renderFrames(
  spec: VideoSpec,
  opts: { repoPath: string; outDir: string; aspectRatios?: AspectRatio[] },
): Promise<RenderFramesResult> {
  const ratios = opts.aspectRatios ?? spec.meta.aspectRatios;
  mkdirSync(opts.outDir, { recursive: true });
  const wm = watermarkText(spec);

  const frames: FrameInfo[] = [];
  const resolvedCode: ResolvedInfo[] = [];
  const skipped: { scene: number; kind: string; reason: string }[] = [];
  const warnings: { scene: number; message: string }[] = [];

  for (const ar of ratios) {
    for (let i = 0; i < spec.scenes.length; i++) {
      const scene = spec.scenes[i]!;
      if (!isComposable(scene.kind)) {
        if (ar === ratios[0]) skipped.push({ scene: i, kind: scene.kind, reason: framesOnlySkipReason(scene.kind) });
        continue;
      }
      const r = await renderSceneToPng(scene, { repoPath: opts.repoPath, aspectRatio: ar, watermark: wm });
      const name = `scene-${String(i).padStart(3, "0")}-${ar.replace(":", "x")}.png`;
      const path = join(opts.outDir, name);
      writeFileSync(path, r.png);
      frames.push({ scene: i, kind: scene.kind, aspectRatio: ar, path, width: r.width, height: r.height });
      if (ar === ratios[0]) recordSceneMeta(r, i, { resolvedCode, warnings });
    }
  }

  return { outDir: opts.outDir, aspectRatios: ratios, frames, resolvedCode, skipped, warnings };
}

// ---------------------------------------------------------------------------
// Full video render — two-pass (TTS → durations → frames → clips → concat).
// ---------------------------------------------------------------------------

/** Tail of silence after narration so the last word isn't clipped. */
const TAIL_SEC = 0.6;
const DETERMINISTIC_GENERATED_AT = "1970-01-01T00:00:00.000Z";

export interface SceneTiming {
  scene: number;
  kind: string;
  narrationMs: number;
  durationSec: number;
  auto: boolean;
  ttsCached: boolean;
}

export interface VideoOutput {
  aspectRatio: AspectRatio;
  path: string;
  durationMs: number;
}

export interface RenderVideoResult {
  outputs: VideoOutput[];
  scenes: SceneTiming[];
  resolvedCode: ResolvedInfo[];
  skipped: { scene: number; kind: string; reason: string }[];
  warnings: { scene: number; message: string }[];
  /** The bundle's manifest.json (videos + this = a portable, player-ready bundle). */
  manifest: VideoManifest;
  manifestPath: string;
}

export async function renderVideo(
  spec: VideoSpec,
  opts: { repoPath: string; outDir: string; baseName: string; aspectRatios?: AspectRatio[]; cacheDir?: string },
): Promise<RenderVideoResult> {
  const ratios = opts.aspectRatios ?? spec.meta.aspectRatios;
  const cacheDir = opts.cacheDir ?? ".agent-video/cache";
  const fps = spec.meta.fps;
  const provider = spec.meta.tts?.provider ?? "say";
  const voice = spec.meta.tts?.voice;
  const model = spec.meta.tts?.model;
  const wm = watermarkText(spec);

  mkdirSync(opts.outDir, { recursive: true });
  const workDir = join(opts.outDir, ".work");
  rmSync(workDir, { recursive: true, force: true });
  mkdirSync(workDir, { recursive: true });

  // Pass 1 — TTS per renderable scene (audio is aspect-ratio independent).
  const renderable = spec.scenes.map((s, i) => ({ s, i })).filter(({ s }) => isRenderable(s.kind));
  const skipped = spec.scenes
    .map((s, i) => ({ s, i }))
    .filter(({ s }) => !isRenderable(s.kind))
    .map(({ s, i }) => ({ scene: i, kind: s.kind, reason: "scene kind not renderable yet" }));

  const timings: SceneTiming[] = [];
  const audioByScene = new Map<number, string>();
  for (const { s, i } of renderable) {
    const syn = await synthesize({ text: s.narration, voice, model }, { provider, cacheDir: join(cacheDir, "tts") });
    const auto = s.duration === "auto";
    const durationSec = auto ? syn.durationMs / 1000 + TAIL_SEC : (s.duration as number);
    timings.push({
      scene: i,
      kind: s.kind,
      narrationMs: syn.durationMs,
      durationSec: Math.round(durationSec * 1000) / 1000,
      auto,
      ttsCached: syn.cached,
    });
    audioByScene.set(i, syn.wavPath);
  }

  // Pass 2 — per aspect ratio: render frames → per-scene clips → concat.
  const outputs: VideoOutput[] = [];
  const resolvedCode: ResolvedInfo[] = [];
  const warnings: { scene: number; message: string }[] = [];
  // Persist one still per scene (from the first ratio) as a bundle thumbnail.
  const thumbnails: Record<number, string> = {};
  for (const ar of ratios) {
    const clips: string[] = [];
    const dims = dimsFor(ar);
    // One watermark overlay PNG per ratio (for screencap video clips).
    let wmPng: string | undefined;
    if (wm !== false) {
      wmPng = join(workDir, `wm-${ar.replace(":", "x")}.png`);
      writeFileSync(wmPng, renderWatermarkPng(ar, wm)); // wm is a string here (watermarkText returns string | false)
    }
    for (const t of timings) {
      const scene = spec.scenes[t.scene]!;
      const tag = `s${String(t.scene).padStart(3, "0")}-${ar.replace(":", "x")}`;
      const clip = join(workDir, `${tag}.mp4`);

      if (scene.kind === "screencap") {
        const ref = scene.content.sessionRef ?? "";
        const source = resolveSession(ref, opts.repoPath);
        const clipRange = scene.content.clip;
        const clipStartSec = clipRange?.start ?? 0;
        const clipDurationSec = clipRange ? clipRange.end - clipRange.start : undefined;
        // Auto-direct: if the session recorded the agent's actions, compute the
        // spring camera; otherwise it's a flat fit-to-frame.
        const rawEvents = loadSessionEvents(ref, opts.repoPath);
        const events =
          rawEvents && clipRange
            ? rawEvents
                .filter((e) => e.t >= clipRange.start * 1000 && e.t <= clipRange.end * 1000)
                .map((e) => ({ ...e, t: e.t - clipRange.start * 1000 }))
            : rawEvents;
        let camera, sourceSize;
        if (events && events.length > 0) {
          sourceSize = probeVideoSize(source);
          camera = computeCameraTimeline(events, { durationSec: t.durationSec, fps, source: sourceSize });
        }
        compositeScreencap({
          source,
          sourceStartSec: clipStartSec,
          sourceDurationSec: clipDurationSec,
          outPath: clip,
          width: dims.width,
          height: dims.height,
          durationSec: t.durationSec,
          fps,
          audio: audioByScene.get(t.scene),
          watermarkPng: wmPng,
          camera,
          sourceSize,
        });
        clips.push(clip);
        continue;
      }

      const rendered = await renderSceneToPng(scene, { repoPath: opts.repoPath, aspectRatio: ar, watermark: wm });
      const png = join(workDir, `${tag}.png`);
      writeFileSync(png, rendered.png);
      if (ar === ratios[0]) {
        recordSceneMeta(rendered, t.scene, { resolvedCode, warnings });
        const thumbName = `thumb-${String(t.scene).padStart(3, "0")}.png`;
        writeFileSync(join(opts.outDir, thumbName), rendered.png);
        thumbnails[t.scene] = thumbName;
      }
      imageAudioToClip({
        image: png,
        audio: audioByScene.get(t.scene)!,
        durationSec: t.durationSec,
        fps,
        outPath: clip,
      });
      clips.push(clip);
    }
    const out = join(opts.outDir, `${opts.baseName}-${ar.replace(":", "x")}.mp4`);
    if (clips.length === 1) copyFileSync(clips[0]!, out);
    else concatClips(clips, out, workDir);
    outputs.push({ aspectRatio: ar, path: out, durationMs: probeDurationMs(out) });
  }

  const manifest = buildManifest({
    spec,
    outputs,
    scenes: timings,
    thumbnails,
    repo: { path: opts.repoPath, ...readRepoMeta(opts.repoPath) },
    generatedAt: DETERMINISTIC_GENERATED_AT,
  });
  const manifestPath = join(opts.outDir, "manifest.json");
  writeFileSync(manifestPath, JSON.stringify(manifest, null, 2) + "\n");
  rmSync(workDir, { recursive: true, force: true });

  return { outputs, scenes: timings, resolvedCode, skipped, warnings, manifest, manifestPath };
}
