/**
 * Render orchestrator. v1a stage: spec → still PNG frames per scene per aspect
 * ratio (silent). Next stages add TTS, two-pass `auto` durations, and the
 * ffmpeg mux to mp4.
 */
import { mkdirSync, writeFileSync, copyFileSync } from "node:fs";
import { join } from "node:path";
import { createHash } from "node:crypto";
import type { VideoSpec, AspectRatio } from "@agent-video/core";
import { renderSceneToPng, renderWatermarkPng, dimsFor, COMPOSABLE_KINDS } from "@agent-video/compose";
import { synthesize, probeDurationMs } from "@agent-video/providers";
import { resolveSession, compositeScreencap } from "@agent-video/capture";
import { imageAudioToClip, concatClips } from "./ffmpeg.ts";

export { probeDurationMs } from "@agent-video/providers";
export { startPreviewServer, type PreviewHandle, type PreviewOutput } from "./preview.ts";

function isComposable(kind: string): boolean {
  return (COMPOSABLE_KINDS as readonly string[]).includes(kind);
}

/** Scene kinds the renderer can turn into a clip (compose stills + capture video). */
function isRenderable(kind: string): boolean {
  return isComposable(kind) || kind === "screencap";
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
}

function watermarkText(spec: VideoSpec): string | false {
  const w = spec.meta.watermark;
  if (w === false) return false;
  return typeof w === "string" ? w : "agent-video.dev";
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

  for (const ar of ratios) {
    for (let i = 0; i < spec.scenes.length; i++) {
      const scene = spec.scenes[i]!;
      if (!(COMPOSABLE_KINDS as readonly string[]).includes(scene.kind)) {
        if (ar === ratios[0]) skipped.push({ scene: i, kind: scene.kind, reason: "kind not composable yet (v1a: title, code)" });
        continue;
      }
      const r = await renderSceneToPng(scene, { repoPath: opts.repoPath, aspectRatio: ar, watermark: wm });
      const name = `scene-${String(i).padStart(3, "0")}-${ar.replace(":", "x")}.png`;
      const path = join(opts.outDir, name);
      writeFileSync(path, r.png);
      frames.push({ scene: i, kind: scene.kind, aspectRatio: ar, path, width: r.width, height: r.height });
      if (r.resolved && ar === ratios[0]) {
        resolvedCode.push({
          scene: i,
          file: r.resolved.file,
          bytes: Buffer.byteLength(r.resolved.text),
          sha256: createHash("sha256").update(r.resolved.text).digest("hex"),
        });
      }
    }
  }

  return { outDir: opts.outDir, aspectRatios: ratios, frames, resolvedCode, skipped };
}

// ---------------------------------------------------------------------------
// Full video render — two-pass (TTS → durations → frames → clips → concat).
// ---------------------------------------------------------------------------

/** Tail of silence after narration so the last word isn't clipped. */
const TAIL_SEC = 0.6;

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
        const source = resolveSession(scene.content.sessionRef ?? "", opts.repoPath);
        compositeScreencap({
          source,
          outPath: clip,
          width: dims.width,
          height: dims.height,
          durationSec: t.durationSec,
          fps,
          audio: audioByScene.get(t.scene),
          watermarkPng: wmPng,
        });
        clips.push(clip);
        continue;
      }

      const rendered = await renderSceneToPng(scene, { repoPath: opts.repoPath, aspectRatio: ar, watermark: wm });
      const png = join(workDir, `${tag}.png`);
      writeFileSync(png, rendered.png);
      if (rendered.warning && ar === ratios[0]) warnings.push({ scene: t.scene, message: rendered.warning });
      if (rendered.resolved && ar === ratios[0]) {
        resolvedCode.push({
          scene: t.scene,
          file: rendered.resolved.file,
          bytes: Buffer.byteLength(rendered.resolved.text),
          sha256: sha256(rendered.resolved.text),
        });
      }
      imageAudioToClip({ image: png, audio: audioByScene.get(t.scene)!, durationSec: t.durationSec, fps, outPath: clip });
      clips.push(clip);
    }
    const out = join(opts.outDir, `${opts.baseName}-${ar.replace(":", "x")}.mp4`);
    if (clips.length === 1) copyFileSync(clips[0]!, out);
    else concatClips(clips, out, workDir);
    outputs.push({ aspectRatio: ar, path: out, durationMs: probeDurationMs(out) });
  }

  return { outputs, scenes: timings, resolvedCode, skipped, warnings };
}
