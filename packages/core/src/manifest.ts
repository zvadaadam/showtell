/**
 * The showtell MANIFEST — the portable description of a rendered bundle
 * (the mp4s + this manifest.json). The renderer EMITS it; the web player
 * CONSUMES only it. This is the seam between the deterministic renderer and the
 * presentation layer.
 *
 * Like the spec, the zod schema here is the source of truth: TypeScript types
 * are inferred from it and manifest.schema.json is generated from it. Bump
 * `version` on any breaking change to the shape.
 */
import { z } from "zod";
import { basename } from "node:path";
import { zodToJsonSchema } from "zod-to-json-schema";
import { AspectRatio, sceneRefs, type VideoSpec } from "./spec.ts";

/** Bump on any breaking change to the manifest shape. */
export const MANIFEST_VERSION = 1 as const;

export const ManifestRefs = z
  .object({
    file: z.string(),
    lineStart: z.number().int().positive().optional(),
    lineEnd: z.number().int().positive().optional(),
    ref: z.string().optional(),
  })
  .strict()
  .describe("The ground-truth repo reference a code/diff scene points at.");

export const ManifestScene = z
  .object({
    index: z.number().int().nonnegative().describe("Index into the spec's scenes array."),
    kind: z.string(),
    id: z.string().optional(),
    narration: z.string(),
    startSec: z.number().nonnegative().describe("Start offset within the video (cumulative)."),
    durationSec: z.number().nonnegative(),
    refs: ManifestRefs.optional(),
    thumbnail: z.string().optional().describe("Bundle-relative still frame for this scene."),
  })
  .strict();

export const ManifestOutput = z
  .object({
    aspectRatio: AspectRatio,
    file: z.string().describe("Bundle-relative mp4 filename."),
    durationMs: z.number().nonnegative(),
  })
  .strict();

export const VideoManifest = z
  .object({
    version: z.literal(MANIFEST_VERSION),
    generatedAt: z.string().describe("ISO timestamp the bundle was rendered."),
    meta: z
      .object({
        title: z.string(),
        repo: z
          .object({
            path: z.string(),
            commit: z.string().optional(),
            branch: z.string().optional(),
          })
          .strict(),
      })
      .strict(),
    durationSec: z.number().nonnegative().describe("Total video length."),
    outputs: z.array(ManifestOutput).min(1),
    scenes: z.array(ManifestScene),
  })
  .strict()
  .describe("Portable description of a rendered showtell bundle.");

export type ManifestRefs = z.infer<typeof ManifestRefs>;
export type ManifestScene = z.infer<typeof ManifestScene>;
export type ManifestOutput = z.infer<typeof ManifestOutput>;
export type VideoManifest = z.infer<typeof VideoManifest>;

export function videoManifestJsonSchema(): Record<string, unknown> {
  return zodToJsonSchema(VideoManifest, { name: "VideoManifest", $refStrategy: "none" }) as Record<string, unknown>;
}

const round = (n: number): number => Math.round(n * 1000) / 1000;

export interface BuildManifestInput {
  spec: VideoSpec;
  /** Rendered outputs (one per aspect ratio). */
  outputs: { aspectRatio: z.infer<typeof AspectRatio>; path: string; durationMs: number }[];
  /** Per-scene timings, in play order — the scenes actually in the video. */
  scenes: { scene: number; kind: string; durationSec: number }[];
  /** Bundle-relative thumbnail filename, keyed by scene index. */
  thumbnails?: Record<number, string>;
  repo: { path: string; commit?: string; branch?: string };
  /** ISO timestamp — injected so buildManifest stays a pure function. */
  generatedAt: string;
}

/**
 * Assemble (and self-validate) a manifest from a spec + its render result.
 * Pure: the only clock value (`generatedAt`) is injected by the caller, so the
 * renderer/core stay deterministic given their inputs.
 */
export function buildManifest(input: BuildManifestInput): VideoManifest {
  let acc = 0;
  const scenes = input.scenes.map((t) => {
    const specScene = input.spec.scenes[t.scene];
    const startSec = acc;
    acc += t.durationSec;
    return {
      index: t.scene,
      kind: t.kind,
      id: specScene?.id,
      narration: specScene?.narration ?? "",
      startSec: round(startSec),
      durationSec: round(t.durationSec),
      refs: specScene ? sceneRefs(specScene) : undefined,
      thumbnail: input.thumbnails?.[t.scene],
    };
  });
  return VideoManifest.parse({
    version: MANIFEST_VERSION,
    generatedAt: input.generatedAt,
    meta: {
      title: input.spec.meta.title,
      repo: { path: input.repo.path, commit: input.repo.commit, branch: input.repo.branch },
    },
    durationSec: round(acc),
    outputs: input.outputs.map((o) => ({
      aspectRatio: o.aspectRatio,
      file: basename(o.path),
      durationMs: o.durationMs,
    })),
    scenes,
  });
}
