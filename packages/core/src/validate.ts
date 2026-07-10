/**
 * Spec validation — agent-first: returns structured, actionable results.
 * Every error carries a JSON path, a human message, and (where we can infer one)
 * a `hint` telling the agent exactly how to fix it.
 */
import type { ZodIssue } from "zod";
import { VideoSpec, IMPLEMENTED_SCENE_KINDS, type SceneKind } from "./spec.ts";

export interface SpecError {
  /** Dotted JSON path to the offending field, e.g. "scenes.2.content.file". */
  path: string;
  message: string;
  hint?: string;
}

export type ValidationResult =
  | { ok: true; spec: import("./spec.ts").VideoSpec; warnings: SpecError[] }
  | { ok: false; errors: SpecError[]; warnings: SpecError[] };

function hintFor(issue: ZodIssue): string | undefined {
  const path = issue.path.join(".");
  if (issue.code === "invalid_union_discriminator" || path.endsWith("kind")) {
    return 'Set "kind" to one of: title, code, diff, talking-points, chart, screencap.';
  }
  if (issue.code === "unrecognized_keys") {
    return "Remove the unexpected key(s); the spec schema is strict. Run `showtell schema` to see allowed fields.";
  }
  if (path.endsWith("narration")) {
    return "Every scene needs a non-empty 'narration' string — it drives the audio and the auto duration.";
  }
  if (path.includes("content.file")) {
    return "Use a repo-relative path to a real file. The renderer reads its live bytes — do not paste source into the spec.";
  }
  if (path === "scenes" && issue.code === "too_small") {
    return "Add at least one scene to 'scenes'.";
  }
  return undefined;
}

/** Validate unknown JSON against the VideoSpec contract. */
export function validateSpec(data: unknown): ValidationResult {
  const parsed = VideoSpec.safeParse(data);
  const warnings: SpecError[] = [];

  if (!parsed.success) {
    const errors = parsed.error.issues.map((issue): SpecError => {
      const e: SpecError = {
        path: issue.path.join(".") || "(root)",
        message: issue.message,
      };
      const hint = hintFor(issue);
      if (hint) e.hint = hint;
      return e;
    });
    return { ok: false, errors, warnings };
  }

  // Valid against the contract — surface forward-looking warnings (non-fatal).
  const MAX_LEGIBLE_LINES = 25;
  parsed.data.scenes.forEach((scene, i) => {
    if (!IMPLEMENTED_SCENE_KINDS.includes(scene.kind as SceneKind)) {
      warnings.push({
        path: `scenes.${i}.kind`,
        message: `Scene kind "${scene.kind}" is valid but not yet renderable.`,
        hint: `Currently renderable: ${IMPLEMENTED_SCENE_KINDS.join(", ")}. It validates now and will render once that kind ships.`,
      });
    }
    // Code excerpts that are too tall get a tiny font + "+N more lines" truncation
    // that hides the point. Nudge the author toward a focused window.
    if (scene.kind === "code" && scene.content.lineStart && scene.content.lineEnd) {
      const span = scene.content.lineEnd - scene.content.lineStart + 1;
      if (span > MAX_LEGIBLE_LINES) {
        warnings.push({
          path: `scenes.${i}.content`,
          message: `Code excerpt spans ${span} lines — only ~${MAX_LEGIBLE_LINES} render legibly; the rest is windowed away.`,
          hint: `Tighten the range to ~6–25 lines around what the narration discusses, and set "focus" on the key line(s).`,
        });
      }
    }
  });

  return { ok: true, spec: parsed.data, warnings };
}
