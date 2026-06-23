/**
 * Render orchestrator. v1a stage: spec → still PNG frames per scene per aspect
 * ratio (silent). Next stages add TTS, two-pass `auto` durations, and the
 * ffmpeg mux to mp4.
 */
import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { createHash } from "node:crypto";
import type { VideoSpec, AspectRatio } from "@agent-video/core";
import { renderSceneToPng, COMPOSABLE_KINDS } from "@agent-video/compose";

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
