/** Education primitives: FunctionPlot (numeric x/y curves) and Formula (display equations). */
import { Path2D, type SKRSContext2D } from "@napi-rs/canvas";
import type { HyperframeElement } from "@agent-video/hyperframes";
import { roundRect } from "../draw.ts";
import { propsOf, type Box } from "../render-hyperframe-shared.ts";
import { clamp01, easeOutCubic, enter01, pulse01 } from "./motion.ts";
import { fontFor, setTracking } from "./typography.ts";
import { rgba, toneColor, type RenderEnv } from "./tokens.ts";

/* ------------------------------------------------------------------ */
/* FunctionPlot                                                        */
/* ------------------------------------------------------------------ */

interface XY {
  x: number;
  y: number;
}

function xyList(raw: unknown): XY[] {
  if (!Array.isArray(raw)) return [];
  const out: XY[] = [];
  for (const item of raw) {
    if (!item || typeof item !== "object") continue;
    const record = item as Record<string, unknown>;
    if (typeof record.x === "number" && typeof record.y === "number" && Number.isFinite(record.x + record.y)) {
      out.push({ x: record.x, y: record.y });
    }
  }
  return out;
}

interface PlotScale {
  x(value: number): number;
  y(value: number): number;
  minX: number;
  maxX: number;
  minY: number;
  maxY: number;
}

function plotScale(points: XY[], extra: XY[], area: Box): PlotScale {
  const all = [...points, ...extra];
  let minX = Math.min(...all.map((p) => p.x));
  let maxX = Math.max(...all.map((p) => p.x));
  let minY = Math.min(...all.map((p) => p.y));
  let maxY = Math.max(...all.map((p) => p.y));
  const padX = (maxX - minX || 1) * 0.06;
  const padY = (maxY - minY || 1) * 0.1;
  // Never pad past zero when the data itself never crosses it (heights,
  // balances, probabilities — a negative axis would read as nonsense).
  minX = minX >= 0 ? Math.max(0, minX - padX) : minX - padX;
  maxX += padX;
  minY = minY >= 0 ? Math.max(0, minY - padY) : minY - padY;
  maxY += padY;
  return {
    minX,
    maxX,
    minY,
    maxY,
    x: (value) => area.x + ((value - minX) / (maxX - minX)) * area.w,
    y: (value) => area.y + area.h - ((value - minY) / (maxY - minY)) * area.h,
  };
}

function tickValues(min: number, max: number, count: number): number[] {
  const ticks: number[] = [];
  for (let i = 0; i <= count; i++) ticks.push(min + ((max - min) / count) * i);
  return ticks;
}

function formatTick(value: number): string {
  if (Math.abs(value) >= 100) return String(Math.round(value));
  if (Math.abs(value) < 0.005) return "0";
  return String(Number(value.toPrecision(2)));
}

/** Arc-length position along a polyline at t∈[0,1]. */
function alongPath(path: XY[], t: number, scale: PlotScale): { px: number; py: number; x: number; y: number } {
  const pts = path.map((p) => ({ px: scale.x(p.x), py: scale.y(p.y), x: p.x, y: p.y }));
  if (pts.length === 1) return pts[0]!;
  const lengths: number[] = [];
  let total = 0;
  for (let i = 1; i < pts.length; i++) {
    const d = Math.hypot(pts[i]!.px - pts[i - 1]!.px, pts[i]!.py - pts[i - 1]!.py);
    lengths.push(d);
    total += d;
  }
  let remaining = clamp01(t) * total;
  for (let i = 1; i < pts.length; i++) {
    const d = lengths[i - 1]!;
    if (remaining <= d || i === pts.length - 1) {
      const f = d > 0 ? remaining / d : 1;
      return {
        px: pts[i - 1]!.px + (pts[i]!.px - pts[i - 1]!.px) * f,
        py: pts[i - 1]!.py + (pts[i]!.py - pts[i - 1]!.py) * f,
        x: pts[i - 1]!.x + (pts[i]!.x - pts[i - 1]!.x) * f,
        y: pts[i - 1]!.y + (pts[i]!.y - pts[i - 1]!.y) * f,
      };
    }
    remaining -= d;
  }
  return pts[pts.length - 1]!;
}

/** Curve slope at x via finite differences on the sampled points. */
function slopeAt(points: XY[], x: number): number {
  if (points.length < 2) return 0;
  let best = 0;
  for (let i = 1; i < points.length; i++) {
    if (points[i]!.x >= x || i === points.length - 1) {
      best = (points[i]!.y - points[i - 1]!.y) / (points[i]!.x - points[i - 1]!.x || 1);
      break;
    }
  }
  return best;
}

/**
 * A numeric x/y plot for education videos: gridlines and tick labels, a smooth
 * sampled curve with an area fade, an optional waypoint `path` (e.g. descent
 * steps) with a marker ball that travels it by arc length, reached-step dots,
 * and an optional tangent segment at the ball. `progress` maps to a range for
 * narration-synced travel; stills render the end state.
 */
export function drawFunctionPlot(ctx: SKRSContext2D, element: HyperframeElement, box: Box, env: RenderEnv): void {
  const props = propsOf(element);
  const points = xyList(props.points);
  if (points.length < 2) return;
  const path = xyList(props.path);
  const base = Math.min(env.dims.width, env.dims.height);
  const tickSize = Math.max(12, Math.round(base * 0.016));
  const labelSize = Math.max(13, Math.round(base * 0.018));

  const area: Box = {
    x: box.x + tickSize * 2.6,
    y: box.y + labelSize * 1.4,
    w: box.w - tickSize * 3.2,
    h: box.h - labelSize * 1.4 - tickSize * 2.4,
  };
  if (area.w < 10 || area.h < 10) return;
  const scale = plotScale(points, path, area);

  // Grid + ticks
  ctx.lineWidth = 1;
  ctx.strokeStyle = rgba(env.palette.fg, 0.07);
  ctx.font = fontFor(env, "medium", tickSize);
  ctx.fillStyle = env.palette.subtle;
  for (const tick of tickValues(scale.minY, scale.maxY, 4)) {
    const y = scale.y(tick);
    ctx.beginPath();
    ctx.moveTo(area.x, y);
    ctx.lineTo(area.x + area.w, y);
    ctx.stroke();
    ctx.textAlign = "right";
    ctx.textBaseline = "middle";
    ctx.fillText(formatTick(tick), area.x - tickSize * 0.6, y);
  }
  for (const tick of tickValues(scale.minX, scale.maxX, 4)) {
    const x = scale.x(tick);
    ctx.beginPath();
    ctx.moveTo(x, area.y);
    ctx.lineTo(x, area.y + area.h);
    ctx.stroke();
    ctx.textAlign = "center";
    ctx.textBaseline = "top";
    ctx.fillText(formatTick(tick), x, area.y + area.h + tickSize * 0.5);
  }

  // Axis labels
  const xLabel = typeof props.xLabel === "string" ? props.xLabel : undefined;
  const yLabel = typeof props.yLabel === "string" ? props.yLabel : undefined;
  ctx.font = fontFor(env, "semibold", labelSize);
  ctx.fillStyle = env.palette.fg;
  if (yLabel) {
    ctx.textAlign = "left";
    ctx.textBaseline = "bottom";
    ctx.fillText(yLabel, area.x, area.y - labelSize * 0.35);
  }
  if (xLabel) {
    ctx.textAlign = "right";
    ctx.textBaseline = "bottom";
    ctx.fillText(xLabel, area.x + area.w, area.y - labelSize * 0.35);
  }

  // Curve: sweeps in on scene entry; area fade underneath.
  const sweep = easeOutCubic(enter01(env, 150, 900));
  ctx.save();
  if (sweep < 1) {
    ctx.beginPath();
    ctx.rect(area.x, box.y, area.w * sweep, box.h);
    ctx.clip();
  }
  ctx.beginPath();
  points.forEach((p, i) => {
    if (i === 0) ctx.moveTo(scale.x(p.x), scale.y(p.y));
    else ctx.lineTo(scale.x(p.x), scale.y(p.y));
  });
  const areaFill = ctx.createLinearGradient(0, area.y, 0, area.y + area.h);
  areaFill.addColorStop(0, rgba(env.palette.accent, env.palette.isLight ? 0.1 : 0.14));
  areaFill.addColorStop(1, rgba(env.palette.accent, 0));
  const curvePath = new Path2D();
  points.forEach((p, i) => {
    if (i === 0) curvePath.moveTo(scale.x(p.x), scale.y(p.y));
    else curvePath.lineTo(scale.x(p.x), scale.y(p.y));
  });
  const fillPath = new Path2D(curvePath);
  fillPath.lineTo(scale.x(points[points.length - 1]!.x), area.y + area.h);
  fillPath.lineTo(scale.x(points[0]!.x), area.y + area.h);
  fillPath.closePath();
  ctx.fillStyle = areaFill;
  ctx.fill(fillPath);
  ctx.strokeStyle = env.palette.accent;
  ctx.lineWidth = Math.max(3, base * 0.0035);
  ctx.lineJoin = "round";
  ctx.lineCap = "round";
  ctx.stroke(curvePath);
  ctx.restore();

  // Descent path + traveling ball
  if (path.length >= 1) {
    const progress =
      typeof props.progress === "number" ? clamp01(props.progress) : easeOutCubic(enter01(env, 600, 2200));
    const at = alongPath(path, progress, scale);

    // Trail over the traveled waypoints
    ctx.beginPath();
    ctx.moveTo(scale.x(path[0]!.x), scale.y(path[0]!.y));
    const pts = path.map((p) => ({ px: scale.x(p.x), py: scale.y(p.y) }));
    let traveled = 0;
    const lengths: number[] = [];
    let total = 0;
    for (let i = 1; i < pts.length; i++) {
      const d = Math.hypot(pts[i]!.px - pts[i - 1]!.px, pts[i]!.py - pts[i - 1]!.py);
      lengths.push(d);
      total += d;
    }
    let remaining = progress * total;
    for (let i = 1; i < pts.length && remaining > 0; i++) {
      const d = lengths[i - 1]!;
      const f = Math.min(1, remaining / (d || 1));
      ctx.lineTo(
        pts[i - 1]!.px + (pts[i]!.px - pts[i - 1]!.px) * f,
        pts[i - 1]!.py + (pts[i]!.py - pts[i - 1]!.py) * f,
      );
      remaining -= d;
      traveled = i;
    }
    ctx.strokeStyle = env.palette.accent2;
    ctx.lineWidth = Math.max(2.5, base * 0.0028);
    ctx.setLineDash([]);
    ctx.stroke();

    // Reached step dots
    if (props.showSteps !== false) {
      for (let i = 0; i <= traveled && i < path.length; i++) {
        ctx.beginPath();
        ctx.arc(scale.x(path[i]!.x), scale.y(path[i]!.y), Math.max(3.5, base * 0.0042), 0, Math.PI * 2);
        ctx.fillStyle = rgba(env.palette.accent2, 0.85);
        ctx.fill();
      }
    }

    // Tangent segment at the ball
    if (props.tangent) {
      const slope = slopeAt(points, at.x);
      const dxPixels = area.w * 0.13;
      const dyPixels = ((slope * (scale.maxX - scale.minX)) / (scale.maxY - scale.minY)) * (area.h / area.w) * dxPixels;
      ctx.beginPath();
      ctx.moveTo(at.px - dxPixels, at.py + dyPixels);
      ctx.lineTo(at.px + dxPixels, at.py - dyPixels);
      ctx.setLineDash([Math.max(4, base * 0.006), Math.max(4, base * 0.006)]);
      ctx.strokeStyle = env.palette.warning;
      ctx.lineWidth = Math.max(2.5, base * 0.0028);
      ctx.stroke();
      ctx.setLineDash([]);
    }

    // The ball
    const breathe = pulse01(env);
    ctx.beginPath();
    ctx.arc(at.px, at.py, Math.max(9, base * 0.011) * (1.6 + breathe * 0.25), 0, Math.PI * 2);
    ctx.fillStyle = rgba(env.palette.accent2, 0.2);
    ctx.fill();
    ctx.beginPath();
    ctx.arc(at.px, at.py, Math.max(6, base * 0.008), 0, Math.PI * 2);
    ctx.fillStyle = env.palette.fg;
    ctx.fill();
  }
}

/* ------------------------------------------------------------------ */
/* Formula                                                             */
/* ------------------------------------------------------------------ */

interface FormulaLayout {
  tokens: { text: string; highlighted: boolean }[];
  size: number;
  caption?: string;
  captionSize: number;
  captionGap: number;
  height: number;
}

function formulaLayout(ctx: SKRSContext2D, element: HyperframeElement, box: Box, env: RenderEnv): FormulaLayout {
  const props = propsOf(element);
  const base = Math.min(env.dims.width, env.dims.height);
  const text = typeof props.text === "string" ? props.text : "";
  const highlight = Array.isArray(props.highlight)
    ? props.highlight.filter((item): item is string => typeof item === "string")
    : [];
  const caption = typeof props.caption === "string" ? props.caption : undefined;
  let size = Math.round(base * 0.052);
  ctx.font = fontFor(env, "mono", size);
  const width = ctx.measureText(text).width;
  if (width > box.w) size = Math.max(16, Math.floor((size * box.w) / width));
  const captionSize = Math.max(14, Math.round(base * 0.02));
  const captionGap = Math.round(base * 0.024);
  const tokens = text.split(/(\s+)/).map((token) => ({
    text: token,
    highlighted: highlight.some((term) => term.length > 0 && token.includes(term)),
  }));
  let height = size * 1.35;
  if (caption) height += captionGap + captionSize * 1.4;
  return { tokens, size, caption, captionSize, captionGap, height };
}

export function estimateFormulaHeight(
  ctx: SKRSContext2D,
  element: HyperframeElement,
  box: Box,
  env: RenderEnv,
): number {
  return formulaLayout(ctx, element, box, env).height;
}

/**
 * A display equation, rendered in the pinned mono face (full math glyph
 * coverage: θ α ∇ ← ≈ ∂). `highlight` substrings render in the accent color —
 * drive it from `ctx.scene.lineIndex` to spotlight the term being narrated.
 */
export function drawFormula(ctx: SKRSContext2D, element: HyperframeElement, box: Box, env: RenderEnv): void {
  const layout = formulaLayout(ctx, element, box, env);
  const base = Math.min(env.dims.width, env.dims.height);
  let y = box.y + Math.max(0, (box.h - layout.height) / 2);

  ctx.font = fontFor(env, "mono", layout.size);
  setTracking(ctx, 0);
  const widths = layout.tokens.map((token) => ctx.measureText(token.text).width);
  const totalW = widths.reduce((sum, w) => sum + w, 0);
  let x = box.x + (box.w - totalW) / 2;
  const centerY = y + (layout.size * 1.35) / 2;
  ctx.textAlign = "left";
  ctx.textBaseline = "middle";
  layout.tokens.forEach((token, i) => {
    if (token.highlighted) {
      const padX = layout.size * 0.18;
      const chipH = layout.size * 1.3;
      roundRect(ctx, x - padX, centerY - chipH / 2, widths[i]! + padX * 2, chipH, Math.min(10, chipH * 0.2));
      ctx.fillStyle = toneColor("accent", env).fill;
      ctx.fill();
    }
    ctx.fillStyle = token.highlighted ? env.palette.accent : env.palette.fg;
    ctx.fillText(token.text, x, centerY);
    x += widths[i]!;
  });
  y += layout.size * 1.35;

  if (layout.caption) {
    y += layout.captionGap;
    ctx.font = fontFor(env, "medium", layout.captionSize);
    ctx.fillStyle = env.palette.subtle;
    ctx.textAlign = "center";
    ctx.textBaseline = "top";
    ctx.fillText(layout.caption, box.x + box.w / 2, y);
  }
  void base;
}
