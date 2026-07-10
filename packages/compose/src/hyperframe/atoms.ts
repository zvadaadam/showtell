/** Leaf hyperframe atoms: text, lower third, callout, badge, divider, meter. */
import type { SKRSContext2D } from "@napi-rs/canvas";
import type { HyperframeElement } from "@showtell/hyperframes";
import { roundRect, wrapText } from "../draw.ts";
import { propsOf, type Box } from "../render-hyperframe-shared.ts";
import { elementChildren, textContent } from "./element.ts";
import { easeOutCubic, enter01 } from "./motion.ts";
import { drawLaidOutText, fontFor, layoutText, setTracking, textColor } from "./typography.ts";
import { rgba, toneColor, TOKENS, type RenderEnv } from "./tokens.ts";

/* ------------------------------------------------------------------ */
/* Text                                                                */
/* ------------------------------------------------------------------ */

export function estimateTextHeight(ctx: SKRSContext2D, child: HyperframeElement, box: Box, env: RenderEnv): number {
  const props = propsOf(child);
  return layoutText(ctx, env, props.variant, textContent(elementChildren(child)), box.w).height;
}

export function drawTextNode(ctx: SKRSContext2D, element: HyperframeElement, box: Box, env: RenderEnv): void {
  const props = propsOf(element);
  const laid = layoutText(ctx, env, props.variant, textContent(elementChildren(element)), box.w);
  drawLaidOutText(ctx, env, laid, box.x, box.y, textColor(props.variant, env));
}

/* ------------------------------------------------------------------ */
/* Lower third                                                         */
/* ------------------------------------------------------------------ */

export function estimateLowerThirdHeight(
  ctx: SKRSContext2D,
  element: HyperframeElement,
  box: Box,
  env: RenderEnv,
): number {
  const props = propsOf(element);
  const base = Math.min(env.dims.width, env.dims.height);
  let height = 0;
  if (typeof props.eyebrow === "string") {
    height += layoutText(ctx, env, "eyebrow", props.eyebrow, box.w).height + Math.round(base * 0.014);
  }
  height += layoutText(ctx, env, "title", typeof props.title === "string" ? props.title : "", box.w).height;
  if (typeof props.subtitle === "string") {
    height += Math.round(base * 0.014) + layoutText(ctx, env, "body", props.subtitle, box.w).height;
  }
  return height;
}

export function drawLowerThird(ctx: SKRSContext2D, element: HyperframeElement, box: Box, env: RenderEnv): void {
  const props = propsOf(element);
  const base = Math.min(env.dims.width, env.dims.height);
  let y = box.y;
  if (typeof props.eyebrow === "string") {
    const eyebrow = layoutText(ctx, env, "eyebrow", props.eyebrow, box.w);
    drawLaidOutText(ctx, env, eyebrow, box.x, y, env.palette.accent);
    y += eyebrow.height + Math.round(base * 0.014);
  }
  const title = layoutText(ctx, env, "title", typeof props.title === "string" ? props.title : "", box.w);
  drawLaidOutText(ctx, env, title, box.x, y, env.palette.fg);
  y += title.height;
  if (typeof props.subtitle === "string") {
    y += Math.round(base * 0.014);
    const subtitle = layoutText(ctx, env, "body", props.subtitle, box.w);
    drawLaidOutText(ctx, env, subtitle, box.x, y, rgba(env.palette.fg, 0.72));
  }
}

/* ------------------------------------------------------------------ */
/* Callout                                                             */
/* ------------------------------------------------------------------ */

interface CalloutLayout {
  lines: string[];
  size: number;
  lineH: number;
  padX: number;
  padY: number;
  barW: number;
  height: number;
}

function calloutLayout(ctx: SKRSContext2D, element: HyperframeElement, box: Box, env: RenderEnv): CalloutLayout {
  const props = propsOf(element);
  const base = Math.min(env.dims.width, env.dims.height);
  const size = Math.round(base * 0.024);
  const padX = Math.round(base * 0.03);
  const padY = Math.round(base * 0.02);
  const barW = Math.max(4, Math.round(base * 0.005));
  ctx.font = fontFor(env, "medium", size);
  const text = typeof props.text === "string" ? props.text : "";
  const lines = wrapText(ctx, text, Math.max(1, box.w - padX * 2 - barW)).slice(0, 2);
  const lineH = size * 1.35;
  return { lines, size, lineH, padX, padY, barW, height: lines.length * lineH + padY * 2 };
}

export function estimateCalloutHeight(
  ctx: SKRSContext2D,
  element: HyperframeElement,
  box: Box,
  env: RenderEnv,
): number {
  if (propsOf(element).when === false) return 0;
  return calloutLayout(ctx, element, box, env).height;
}

export function drawCallout(ctx: SKRSContext2D, element: HyperframeElement, box: Box, env: RenderEnv): void {
  const props = propsOf(element);
  const layout = calloutLayout(ctx, element, box, env);
  const colors = toneColor(props.tone ?? "info", env);
  const height = Math.min(box.h, layout.height);
  const y = box.y + (box.h - height) / 2;
  const radius = Math.min(14, height / 2);
  roundRect(ctx, box.x, y, box.w, height, radius);
  ctx.fillStyle = colors.fill;
  ctx.fill();
  roundRect(ctx, box.x, y, layout.barW, height, layout.barW / 2);
  ctx.fillStyle = colors.fg;
  ctx.fill();
  ctx.font = fontFor(env, "medium", layout.size);
  ctx.fillStyle = env.palette.fg;
  ctx.textAlign = "left";
  ctx.textBaseline = "middle";
  let ty = y + layout.padY + layout.lineH / 2;
  for (const line of layout.lines) {
    ctx.fillText(line, box.x + layout.barW + layout.padX, ty);
    ty += layout.lineH;
  }
}

/* ------------------------------------------------------------------ */
/* Badge                                                               */
/* ------------------------------------------------------------------ */

interface BadgeChipSpec {
  text: string;
  size: number;
  chipH: number;
  padX: number;
  dot: boolean;
  dotR: number;
}

export function badgeChipSpec(ctx: SKRSContext2D, env: RenderEnv, element: HyperframeElement): BadgeChipSpec {
  const props = propsOf(element);
  const base = Math.min(env.dims.width, env.dims.height);
  const raw = typeof props.text === "string" ? props.text : textContent(elementChildren(element));
  const text = raw.toUpperCase();
  const size = Math.max(13, Math.round(base * 0.0165));
  const chipH = Math.max(30, Math.round(size * 2.1));
  const padX = Math.round(size * 0.95);
  // Status dot reads as "live state" — only for status words, not number chips.
  const dot = (props.tone === "success" || props.tone === "info") && text.length > 2;
  const dotR = Math.max(3, Math.round(size * 0.24));
  return { text, size, chipH, padX, dot, dotR };
}

export function badgeChipWidth(ctx: SKRSContext2D, env: RenderEnv, element: HyperframeElement): number {
  const spec = badgeChipSpec(ctx, env, element);
  ctx.font = fontFor(env, "semibold", spec.size);
  setTracking(ctx, spec.size * 0.08);
  const textW = ctx.measureText(spec.text).width;
  setTracking(ctx, 0);
  return Math.round(textW + spec.padX * 2 + (spec.dot ? spec.dotR * 2 + spec.size * 0.55 : 0));
}

export function drawBadge(ctx: SKRSContext2D, element: HyperframeElement, box: Box, env: RenderEnv): void {
  const props = propsOf(element);
  const spec = badgeChipSpec(ctx, env, element);
  const colors = toneColor(props.tone, env);
  const w = Math.min(box.w, badgeChipWidth(ctx, env, element));
  const h = Math.min(box.h, spec.chipH);
  const y = box.y + (box.h - h) / 2;
  roundRect(ctx, box.x, y, w, h, h / 2);
  ctx.fillStyle = colors.fill;
  ctx.fill();
  let textX = box.x + spec.padX;
  if (spec.dot) {
    ctx.beginPath();
    ctx.arc(textX + spec.dotR, y + h / 2, spec.dotR, 0, Math.PI * 2);
    ctx.fillStyle = colors.fg;
    ctx.fill();
    textX += spec.dotR * 2 + spec.size * 0.55;
  }
  ctx.font = fontFor(env, "semibold", spec.size);
  setTracking(ctx, spec.size * 0.08);
  ctx.fillStyle = colors.fg;
  ctx.textAlign = "left";
  ctx.textBaseline = "middle";
  ctx.fillText(spec.text, textX, y + h / 2 + spec.size * 0.06);
  setTracking(ctx, 0);
}

/* ------------------------------------------------------------------ */
/* Divider                                                             */
/* ------------------------------------------------------------------ */

export function drawDivider(ctx: SKRSContext2D, element: HyperframeElement, box: Box, env: RenderEnv): void {
  const props = propsOf(element);
  const label = typeof props.label === "string" ? props.label.toUpperCase() : undefined;
  const y = box.y + box.h / 2;
  const base = Math.min(env.dims.width, env.dims.height);
  ctx.strokeStyle = rgba(env.palette.fg, env.palette.isLight ? 0.12 : 0.1);
  ctx.lineWidth = 1.5;
  if (!label) {
    ctx.beginPath();
    ctx.moveTo(box.x, y);
    ctx.lineTo(box.x + box.w, y);
    ctx.stroke();
    return;
  }
  const size = Math.max(12, Math.round(base * 0.016));
  ctx.font = fontFor(env, "semibold", size);
  setTracking(ctx, size * 0.14);
  const textW = ctx.measureText(label).width;
  setTracking(ctx, 0);
  const gap = Math.round(size * 1.1);
  const cx = box.x + box.w / 2;
  ctx.beginPath();
  ctx.moveTo(box.x, y);
  ctx.lineTo(cx - textW / 2 - gap, y);
  ctx.moveTo(cx + textW / 2 + gap, y);
  ctx.lineTo(box.x + box.w, y);
  ctx.stroke();
  ctx.font = fontFor(env, "semibold", size);
  setTracking(ctx, size * 0.14);
  ctx.fillStyle = env.palette.subtle;
  ctx.textAlign = "center";
  ctx.textBaseline = "middle";
  ctx.fillText(label, cx, y);
  setTracking(ctx, 0);
}

/* ------------------------------------------------------------------ */
/* Meter                                                               */
/* ------------------------------------------------------------------ */

function meterProgress(props: Record<string, unknown>): number {
  const raw =
    typeof props.progress === "number"
      ? props.progress
      : typeof props.value === "number" && typeof props.max === "number" && props.max > 0
        ? props.value / props.max
        : 0;
  return Math.max(0, Math.min(1, raw));
}

export function estimateMeterHeight(ctx: SKRSContext2D, element: HyperframeElement, box: Box, env: RenderEnv): number {
  const props = propsOf(element);
  const base = Math.min(env.dims.width, env.dims.height);
  const barH = Math.max(8, Math.round(base * 0.011));
  if (typeof props.label !== "string") return barH + 6;
  return layoutText(ctx, env, "caption", props.label, box.w).lineH + Math.round(base * 0.012) + barH + 6;
}

export function drawMeter(ctx: SKRSContext2D, element: HyperframeElement, box: Box, env: RenderEnv): void {
  const props = propsOf(element);
  const base = Math.min(env.dims.width, env.dims.height);
  const label = typeof props.label === "string" ? props.label : undefined;
  const progress = meterProgress(props);
  const colors = toneColor(props.tone ?? "info", env);
  const barH = Math.max(8, Math.round(base * 0.011));
  let y = box.y;
  if (label) {
    const laid = layoutText(ctx, env, "caption", label, box.w * 0.7);
    ctx.font = fontFor(env, "medium", laid.size);
    ctx.fillStyle = env.palette.fg;
    ctx.textAlign = "left";
    ctx.textBaseline = "middle";
    ctx.fillText(laid.lines[0] ?? label, box.x, y + laid.lineH / 2);
    ctx.font = fontFor(env, "semibold", Math.max(12, Math.round(laid.size * 0.92)));
    ctx.fillStyle = env.palette.subtle;
    ctx.textAlign = "right";
    ctx.fillText(`${Math.round(progress * 100)}%`, box.x + box.w, y + laid.lineH / 2);
    y += laid.lineH + Math.round(base * 0.012);
  }
  roundRect(ctx, box.x, y, box.w, barH, barH / 2);
  ctx.fillStyle = rgba(env.palette.fg, env.palette.isLight ? TOKENS.track.alphaLight : TOKENS.track.alpha);
  ctx.fill();
  // The fill sweeps to its value on scene entry (progress itself may also be live).
  const fillW = box.w * progress * easeOutCubic(enter01(env, 250, 700));
  if (fillW > 0) {
    roundRect(ctx, box.x, y, Math.max(barH, fillW), barH, barH / 2);
    const gradient = ctx.createLinearGradient(box.x, y, box.x + box.w, y);
    gradient.addColorStop(0, rgba(colors.base, 0.75));
    gradient.addColorStop(1, colors.base);
    ctx.fillStyle = gradient;
    ctx.fill();
  }
}
