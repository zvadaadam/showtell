import { copyFileSync, existsSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { AspectRatio, BundleError, VideoManifest, VideoSpec } from "@showtell/core";
import { buildManifest, readRepoMeta } from "@showtell/core";
import { BundleCompileError, renderBundle, type CompiledBundleScene } from "./bundle.ts";
import { lowerSimpleSpec, simpleSceneId } from "./simple-bundle.ts";
import { renderBundleWorkshop } from "./workshop.ts";

const DETERMINISTIC_GENERATED_AT = "1970-01-01T00:00:00.000Z";

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
  resolvedCode: ResolvedInfo[];
  skipped: { scene: number; kind: string; reason: string }[];
  warnings: { scene: number; message: string }[];
}

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
  manifest: VideoManifest;
  manifestPath: string;
}

function watermarkText(spec: VideoSpec): string | false {
  if (spec.meta.watermark === false) return false;
  return typeof spec.meta.watermark === "string" ? spec.meta.watermark : "showtell";
}

function framesOnlySkipReason(): string {
  return "screencap is timed video media (no browser-held still); it renders in full `render`, not `--frames-only`.";
}

function sourceSceneForError(error: BundleError, sceneMap: number[]): number {
  const match = /^scenes\.(\d+)/.exec(error.path);
  return match ? (sceneMap[Number(match[1])] ?? 0) : 0;
}

function simpleWarnings(errors: BundleError[], sceneMap: number[]): { scene: number; message: string }[] {
  return errors.map((error) => ({ scene: sourceSceneForError(error, sceneMap), message: error.message }));
}

function rethrowSimpleCompileError(error: unknown): never {
  if (error instanceof BundleCompileError) {
    const details = error.errors.map((item) => `${item.path}: ${item.message} Hint: ${item.hint}`).join("\n");
    throw new Error(details || error.message, { cause: error });
  }
  throw error;
}

function timingFor(spec: VideoSpec, sourceIndex: number, planScene: CompiledBundleScene): SceneTiming {
  const source = spec.scenes[sourceIndex]!;
  const narrationMs = planScene.narration.lines.reduce((sum, line) => sum + line.audioDurationMs, 0);
  const auto = source.duration === "auto";
  return {
    scene: sourceIndex,
    kind: source.kind,
    narrationMs,
    durationSec: source.duration === "auto" ? Math.round((narrationMs / 1000 + 0.6) * 1000) / 1000 : source.duration,
    auto,
    ttsCached: planScene.narration.lines.every((line) => line.ttsCached),
  };
}

export async function renderFrames(
  spec: VideoSpec,
  opts: { repoPath: string; outDir: string; aspectRatios?: AspectRatio[] },
): Promise<RenderFramesResult> {
  const aspectRatios = opts.aspectRatios ?? spec.meta.aspectRatios;
  const sceneMap = spec.scenes
    .map((scene, index) => ({ scene, index }))
    .filter(({ scene }) => scene.kind !== "screencap")
    .map(({ index }) => index);
  const skipped = spec.scenes.flatMap((scene, index) =>
    scene.kind === "screencap" ? [{ scene: index, kind: scene.kind, reason: framesOnlySkipReason() }] : [],
  );
  mkdirSync(opts.outDir, { recursive: true });
  if (sceneMap.length === 0) {
    return { outDir: opts.outDir, aspectRatios, frames: [], resolvedCode: [], skipped, warnings: [] };
  }

  const tempDir = mkdtempSync(join(tmpdir(), "showtell-simple-frames-"));
  try {
    const lowered = lowerSimpleSpec(spec, {
      bundleDir: join(tempDir, "bundle.showtell"),
      repoPath: opts.repoPath,
      sceneIndices: sceneMap,
    });
    const workshop = await renderBundleWorkshop(lowered.bundleDir, {
      outDir: join(tempDir, "workshop"),
      aspectRatios,
      watermark: watermarkText(spec),
    });
    const sourceById = new Map(sceneMap.map((sourceIndex) => [simpleSceneId(sourceIndex), sourceIndex]));
    const frames: FrameInfo[] = [];
    const resolvedCode: ResolvedInfo[] = [];
    const resolvedKeys = new Set<string>();

    for (const frame of workshop.frames) {
      const sourceIndex = sourceById.get(frame.sceneId);
      if (sourceIndex === undefined) throw new Error(`Workshop returned unknown lowered scene "${frame.sceneId}".`);
      const path = join(
        opts.outDir,
        `scene-${String(sourceIndex).padStart(3, "0")}-${frame.aspectRatio.replace(":", "x")}.png`,
      );
      copyFileSync(join(workshop.outDir, frame.file), path);
      frames.push({
        scene: sourceIndex,
        kind: spec.scenes[sourceIndex]!.kind,
        aspectRatio: frame.aspectRatio,
        path,
        width: frame.width,
        height: frame.height,
      });
      if (frame.aspectRatio === aspectRatios[0]) {
        for (const ref of frame.resolvedRefs) {
          const key = `${sourceIndex}:${ref.file}:${ref.sha256}`;
          if (resolvedKeys.has(key)) continue;
          resolvedKeys.add(key);
          resolvedCode.push({ scene: sourceIndex, ...ref });
        }
      }
    }
    return {
      outDir: opts.outDir,
      aspectRatios,
      frames,
      resolvedCode,
      skipped,
      warnings: simpleWarnings(workshop.warnings, sceneMap),
    };
  } catch (error) {
    rethrowSimpleCompileError(error);
  } finally {
    rmSync(tempDir, { recursive: true, force: true });
  }
}

export async function renderVideo(
  spec: VideoSpec,
  opts: { repoPath: string; outDir: string; baseName: string; aspectRatios?: AspectRatio[]; cacheDir?: string },
): Promise<RenderVideoResult> {
  const aspectRatios = opts.aspectRatios ?? spec.meta.aspectRatios;
  const tempDir = mkdtempSync(join(tmpdir(), "showtell-simple-render-"));
  mkdirSync(opts.outDir, { recursive: true });
  try {
    const lowered = lowerSimpleSpec(spec, { bundleDir: join(tempDir, "bundle.showtell"), repoPath: opts.repoPath });
    const rendered = await renderBundle(lowered.bundleDir, {
      outDir: opts.outDir,
      aspectRatios,
      cacheDir: opts.cacheDir ?? ".showtell/cache",
      baseName: opts.baseName,
      watermark: watermarkText(spec),
    });
    const scenes = rendered.plan.scenes.map((planScene, bundleIndex) =>
      timingFor(spec, lowered.sceneMap[bundleIndex]!, planScene),
    );
    const thumbnails = Object.fromEntries(
      scenes.flatMap((scene, bundleIndex) => {
        const file = `thumb-${String(bundleIndex).padStart(3, "0")}.png`;
        return existsSync(join(opts.outDir, file)) ? [[scene.scene, file]] : [];
      }),
    );
    const outputs: VideoOutput[] = rendered.outputs.map(({ aspectRatio, path, durationMs }) => ({
      aspectRatio,
      path,
      durationMs,
    }));
    const manifest = buildManifest({
      spec,
      outputs,
      scenes,
      thumbnails,
      repo: { path: opts.repoPath, ...readRepoMeta(opts.repoPath) },
      generatedAt: DETERMINISTIC_GENERATED_AT,
    });
    const manifestPath = join(opts.outDir, "manifest.json");
    writeFileSync(manifestPath, `${JSON.stringify(manifest, null, 2)}\n`);
    return {
      outputs,
      scenes,
      resolvedCode: rendered.resolvedCode.map((ref) => ({
        ...ref,
        scene: lowered.sceneMap[ref.scene] ?? ref.scene,
      })),
      skipped: [],
      warnings: simpleWarnings(rendered.warnings, lowered.sceneMap),
      manifest,
      manifestPath,
    };
  } catch (error) {
    rethrowSimpleCompileError(error);
  } finally {
    rmSync(tempDir, { recursive: true, force: true });
  }
}
