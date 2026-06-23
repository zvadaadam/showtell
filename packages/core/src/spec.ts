/**
 * The agent-video spec — the single contract between the LLM (which authors it)
 * and the deterministic renderer (which consumes it).
 *
 * Source of truth: these zod schemas. TypeScript types are inferred from them,
 * and the published JSON Schema (schema.json) is generated from them. The LLM
 * authors a `spec.json` validated against this; it NEVER writes pixels/ffmpeg.
 *
 * Load-bearing rule: `code`/`diff` scenes carry repo REFERENCES (file + lines /
 * git ref), never pasted source — the renderer reads live bytes so rendered code
 * is always ground-truth.
 */
import { z } from "zod";

// ---------------------------------------------------------------------------
// Shared
// ---------------------------------------------------------------------------

/** Scene length: "auto" derives it from the measured narration audio (two-pass). */
export const Duration = z
  .union([z.literal("auto"), z.number().positive()])
  .describe('Seconds, or "auto" to derive from the narration audio length.');

const SceneBase = {
  id: z
    .string()
    .min(1)
    .optional()
    .describe("Stable scene id (defaults to the scene index if omitted)."),
  narration: z
    .string()
    .min(1)
    .describe("Spoken narration for this scene. Always required."),
  duration: Duration.default("auto"),
};

// ---------------------------------------------------------------------------
// Scene kinds
// ---------------------------------------------------------------------------

export const TitleScene = z
  .object({
    kind: z.literal("title"),
    content: z
      .object({
        heading: z.string().min(1),
        subtitle: z.string().optional(),
      })
      .strict(),
    ...SceneBase,
  })
  .strict()
  .describe("A title / section card.");

export const CodeScene = z
  .object({
    kind: z.literal("code"),
    content: z
      .object({
        file: z.string().min(1).describe("Repo-relative path. Read live; never paste source."),
        lineStart: z.number().int().positive().optional(),
        lineEnd: z.number().int().positive().optional(),
        ref: z.string().optional().describe("Optional git ref to read the file at (default: working tree)."),
        focus: z
          .array(z.number().int().positive())
          .optional()
          .describe("Line numbers to emphasize."),
        language: z.string().optional().describe("Override syntax language (else inferred from extension)."),
      })
      .strict(),
    ...SceneBase,
  })
  .strict()
  .describe("A syntax-highlighted code excerpt read from the repo at file:line.");

export const DiffScene = z
  .object({
    kind: z.literal("diff"),
    content: z
      .object({
        file: z.string().min(1),
        ref: z.string().min(1).describe('Git range, e.g. "main..HEAD".'),
        animation: z.enum(["magic-move", "fade"]).default("magic-move"),
        highlight: z.array(z.string()).optional().describe("Tokens/identifiers to emphasize."),
      })
      .strict(),
    ...SceneBase,
  })
  .strict()
  .describe("Animated before/after diff of a file, read from git.");

export const TalkingPointsScene = z
  .object({
    kind: z.literal("talking-points"),
    content: z
      .object({
        heading: z.string().optional(),
        points: z.array(z.string().min(1)).min(1),
      })
      .strict(),
    ...SceneBase,
  })
  .strict()
  .describe("A bulleted list of points (e.g. what reviewers should check).");

export const ChartScene = z
  .object({
    kind: z.literal("chart"),
    content: z
      .object({
        chartType: z.enum(["bar", "line", "pie"]),
        title: z.string().optional(),
        data: z.array(z.record(z.union([z.string(), z.number()]))).min(1),
      })
      .strict(),
    ...SceneBase,
  })
  .strict()
  .describe("A data-driven chart.");

export const ScreencapScene = z
  .object({
    kind: z.literal("screencap"),
    content: z
      .object({
        source: z.enum(["app", "browser", "desktop"]).describe("What to capture (macOS/avfoundation)."),
        sessionRef: z.string().optional().describe("Reference to a recorded capture session."),
        clip: z
          .object({ start: z.number().min(0), end: z.number().positive() })
          .strict()
          .optional(),
      })
      .strict(),
    ...SceneBase,
  })
  .strict()
  .describe("A screen-capture segment (Mode A) composited into the timeline.");

export const Scene = z.discriminatedUnion("kind", [
  TitleScene,
  CodeScene,
  DiffScene,
  TalkingPointsScene,
  ChartScene,
  ScreencapScene,
]);

// ---------------------------------------------------------------------------
// Meta + top-level spec
// ---------------------------------------------------------------------------

export const AspectRatio = z.enum(["16:9", "9:16", "1:1"]);

export const TtsConfig = z
  .object({
    provider: z
      .enum(["say", "replicate", "openai", "elevenlabs"])
      .describe("TTS provider. Local 'say' needs no key; others are BYO-API."),
    model: z.string().optional(),
    voice: z.string().optional(),
  })
  .strict();

export const Meta = z
  .object({
    title: z.string().min(1),
    fps: z.number().int().min(1).max(120).default(30),
    aspectRatios: z.array(AspectRatio).min(1).default(["16:9"]),
    tts: TtsConfig.optional(),
    watermark: z
      .union([z.boolean(), z.string()])
      .default(true)
      .describe('Watermark text; true = "agent-video.dev". Free tier shows it.'),
    repo: z
      .object({
        path: z.string().default("."),
        baseRef: z.string().optional(),
        headRef: z.string().optional(),
      })
      .strict()
      .default({ path: "." }),
  })
  .strict();

export const VideoSpec = z
  .object({
    $schema: z.string().optional(),
    meta: Meta,
    scenes: z.array(Scene).min(1).describe("Ordered scenes; the video plays them in sequence."),
  })
  .strict();

// ---------------------------------------------------------------------------
// Inferred types
// ---------------------------------------------------------------------------

export type Duration = z.infer<typeof Duration>;
export type Scene = z.infer<typeof Scene>;
export type SceneKind = Scene["kind"];
export type TitleScene = z.infer<typeof TitleScene>;
export type CodeScene = z.infer<typeof CodeScene>;
export type DiffScene = z.infer<typeof DiffScene>;
export type TalkingPointsScene = z.infer<typeof TalkingPointsScene>;
export type ChartScene = z.infer<typeof ChartScene>;
export type ScreencapScene = z.infer<typeof ScreencapScene>;
export type Meta = z.infer<typeof Meta>;
export type AspectRatio = z.infer<typeof AspectRatio>;
export type TtsConfig = z.infer<typeof TtsConfig>;
export type VideoSpec = z.infer<typeof VideoSpec>;

/** The set of scene kinds the renderer can currently produce (grows over v1). */
export const IMPLEMENTED_SCENE_KINDS: readonly SceneKind[] = ["title", "code", "diff"];
