/**
 * Hyperframe typography: face resolution, the type scale, and shared
 * measure/draw text layout so estimates always match drawn pixels.
 */
import type { SKRSContext2D } from "@napi-rs/canvas";
import { wrapText } from "../draw.ts";
import { THEME } from "../theme.ts";
import { rgba, type RenderEnv } from "./tokens.ts";

export type FaceRole = "display" | "semibold" | "medium" | "body" | "mono";

/**
 * Resolve a face for a role. When the theme uses the default registered pair
 * (Inter Bold / Inter) the mid weights come from the registered Inter Medium /
 * Inter SemiBold faces; custom theme fonts degrade to their nearest declared face.
 */
export function faceFor(env: RenderEnv, role: FaceRole): string {
  const typography = env.theme?.typography ?? { display: THEME.sansBold, body: THEME.sans, mono: THEME.mono };
  const usesDefaultSans = typography.display === "Inter Bold" && typography.body === "Inter";
  if (role === "display") return typography.display;
  if (role === "mono") return typography.mono;
  if (role === "semibold") return usesDefaultSans ? "Inter SemiBold" : typography.display;
  if (role === "medium") return usesDefaultSans ? "Inter Medium" : typography.body;
  return typography.body;
}

const GREEK_TWINS: Record<string, string> = {
  Inter: "Inter Greek",
  "Inter Medium": "Inter Medium Greek",
  "Inter SemiBold": "Inter SemiBold Greek",
  "Inter Bold": "Inter Bold Greek",
};

/**
 * Font stack with deterministic glyph fallback: the face itself, its Greek
 * twin (θ, α, Δ), and Noto Sans Math as the operator net (∇, ←, ≈, ∂, √, Σ) —
 * education videos never see tofu or nondeterministic system fallback.
 */
export function fontFor(env: RenderEnv, role: FaceRole, size: number): string {
  const face = faceFor(env, role);
  const stack = [face, GREEK_TWINS[face], "Noto Sans Math"]
    .filter(Boolean)
    .map((family) => `'${family}'`)
    .join(", ");
  return `${Math.round(size)}px ${stack}`;
}

export function setTracking(ctx: SKRSContext2D, px: number): void {
  if ("letterSpacing" in ctx) ctx.letterSpacing = `${px.toFixed(2)}px`;
}

export interface TextVariantSpec {
  size: number;
  face: FaceRole;
  lineHeight: number;
  tracking: number;
  uppercase?: boolean;
  maxLines: number;
}

/** The type scale, as fractions of the short frame edge. */
export const TYPE_SCALE: Record<string, TextVariantSpec> = {
  eyebrow: { size: 0.021, face: "semibold", lineHeight: 1.25, tracking: 0.16, uppercase: true, maxLines: 1 },
  title: { size: 0.054, face: "display", lineHeight: 1.14, tracking: -0.015, maxLines: 3 },
  section: { size: 0.031, face: "semibold", lineHeight: 1.3, tracking: -0.004, maxLines: 3 },
  body: { size: 0.026, face: "body", lineHeight: 1.42, tracking: 0, maxLines: 5 },
  caption: { size: 0.021, face: "medium", lineHeight: 1.38, tracking: 0.01, maxLines: 3 },
};

export function textVariant(variant: unknown): TextVariantSpec {
  return TYPE_SCALE[typeof variant === "string" ? variant : "body"] ?? TYPE_SCALE.body!;
}

export interface LaidOutText {
  lines: string[];
  size: number;
  lineH: number;
  spec: TextVariantSpec;
  height: number;
}

/** Shared measure/draw text layout so estimates always match drawn pixels. */
export function layoutText(
  ctx: SKRSContext2D,
  env: RenderEnv,
  variant: unknown,
  text: string,
  maxWidth: number,
): LaidOutText {
  const spec = textVariant(variant);
  const base = Math.min(env.dims.width, env.dims.height);
  const size = Math.round(base * spec.size);
  const content = spec.uppercase ? text.toUpperCase() : text;
  ctx.font = fontFor(env, spec.face, size);
  setTracking(ctx, size * spec.tracking);
  const lines = wrapText(ctx, content, Math.max(1, maxWidth)).slice(0, spec.maxLines);
  setTracking(ctx, 0);
  const lineH = size * spec.lineHeight;
  return { lines, size, lineH, spec, height: lines.length * lineH };
}

export function textColor(variant: unknown, env: RenderEnv): string {
  if (variant === "eyebrow") return env.palette.accent;
  if (variant === "body") return rgba(env.palette.fg, 0.82);
  if (variant === "caption") return env.palette.subtle;
  return env.palette.fg;
}

export function drawLaidOutText(
  ctx: SKRSContext2D,
  env: RenderEnv,
  laid: LaidOutText,
  x: number,
  y: number,
  fill: string,
): void {
  ctx.font = fontFor(env, laid.spec.face, laid.size);
  setTracking(ctx, laid.size * laid.spec.tracking);
  ctx.fillStyle = fill;
  ctx.textAlign = "left";
  ctx.textBaseline = "top";
  let ty = y;
  for (const line of laid.lines) {
    ctx.fillText(line, x, ty + (laid.lineH - laid.size) / 2);
    ty += laid.lineH;
  }
  setTracking(ctx, 0);
}

export function truncateToWidth(ctx: SKRSContext2D, text: string, maxWidth: number): string {
  if (ctx.measureText(text).width <= maxWidth) return text;
  let out = text;
  while (out.length > 1 && ctx.measureText(`${out}…`).width > maxWidth) out = out.slice(0, -1);
  return `${out.trimEnd()}…`;
}
