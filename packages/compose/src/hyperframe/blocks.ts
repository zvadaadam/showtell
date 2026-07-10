/** Showcase blocks: BigStat, Checklist, Quote — the "beautiful by default" layer. */
import type { SKRSContext2D } from "@napi-rs/canvas";
import type { HyperframeElement } from "@showtell/hyperframes";
import { wrapText } from "../draw.ts";
import { propsOf, type Box } from "../render-hyperframe-shared.ts";
import { clamp01, countUpValue, easeOutBack, easeOutCubic, easeOutExpo, enter01, pulse01 } from "./motion.ts";
import { fontFor, setTracking, truncateToWidth } from "./typography.ts";
import { rgba, toneColor, type RenderEnv } from "./tokens.ts";

/* ------------------------------------------------------------------ */
/* BigStat                                                             */
/* ------------------------------------------------------------------ */

interface BigStatLayout {
  label?: string;
  value: string;
  delta?: string;
  labelSize: number;
  valueSize: number;
  deltaSize: number;
  labelGap: number;
  deltaGap: number;
  height: number;
}

function bigStatLayout(element: HyperframeElement, env: RenderEnv): BigStatLayout {
  const props = propsOf(element);
  const base = Math.min(env.dims.width, env.dims.height);
  const label = typeof props.label === "string" ? props.label.toUpperCase() : undefined;
  const value = typeof props.value === "string" ? props.value : String(props.value ?? "");
  const delta = typeof props.delta === "string" ? props.delta : undefined;
  const labelSize = Math.max(13, Math.round(base * 0.0185));
  const valueSize = Math.round(base * 0.082);
  const deltaSize = Math.max(14, Math.round(base * 0.021));
  const labelGap = Math.round(base * 0.012);
  const deltaGap = Math.round(base * 0.014);
  let height = valueSize * 1.05;
  if (label) height += labelSize * 1.2 + labelGap;
  if (delta) height += deltaSize * 1.3 + deltaGap;
  return { label, value, delta, labelSize, valueSize, deltaSize, labelGap, deltaGap, height };
}

export function estimateBigStatHeight(
  _ctx: SKRSContext2D,
  element: HyperframeElement,
  _box: Box,
  env: RenderEnv,
): number {
  return bigStatLayout(element, env).height;
}

export function drawBigStat(ctx: SKRSContext2D, element: HyperframeElement, box: Box, env: RenderEnv): void {
  const props = propsOf(element);
  const layout = bigStatLayout(element, env);
  const center = props.align !== "left";
  const x = center ? box.x + box.w / 2 : box.x;
  ctx.textAlign = center ? "center" : "left";
  ctx.textBaseline = "top";
  let y = box.y + Math.max(0, (box.h - layout.height) / 2);

  if (layout.label) {
    ctx.font = fontFor(env, "semibold", layout.labelSize);
    setTracking(ctx, layout.labelSize * 0.14);
    ctx.fillStyle = env.palette.subtle;
    ctx.fillText(truncateToWidth(ctx, layout.label, box.w), x, y);
    setTracking(ctx, 0);
    y += layout.labelSize * 1.2 + layout.labelGap;
  }

  ctx.font = fontFor(env, "display", layout.valueSize);
  setTracking(ctx, layout.valueSize * -0.02);
  ctx.fillStyle = env.palette.fg;
  const countT = easeOutExpo(enter01(env, 120, 950));
  ctx.fillText(truncateToWidth(ctx, countUpValue(layout.value, countT), box.w), x, y);
  setTracking(ctx, 0);
  y += layout.valueSize * 1.05;

  if (layout.delta) {
    y += layout.deltaGap;
    // Whitespace-only deltas reserve the row (for cross-card alignment) but draw nothing.
    if (layout.delta.trim() === "") return;
    const deltaT = enter01(env, 650, 320);
    if (deltaT <= 0) return;
    ctx.save();
    ctx.globalAlpha *= easeOutCubic(deltaT);
    const down = /^[-−▼]/.test(layout.delta.trim());
    const tone = toneColor(props.deltaTone ?? (down ? "warning" : "success"), env);
    ctx.font = fontFor(env, "semibold", layout.deltaSize);
    const textW = ctx.measureText(layout.delta).width;
    const arrowW = layout.deltaSize * 0.62;
    const arrowH = layout.deltaSize * 0.52;
    const gap = layout.deltaSize * 0.4;
    const startX = center ? x - (arrowW + gap + textW) / 2 : x;
    const arrowY = y + (layout.deltaSize * 1.3 - arrowH) / 2;
    ctx.beginPath();
    if (down) {
      ctx.moveTo(startX, arrowY);
      ctx.lineTo(startX + arrowW, arrowY);
      ctx.lineTo(startX + arrowW / 2, arrowY + arrowH);
    } else {
      ctx.moveTo(startX, arrowY + arrowH);
      ctx.lineTo(startX + arrowW, arrowY + arrowH);
      ctx.lineTo(startX + arrowW / 2, arrowY);
    }
    ctx.closePath();
    ctx.fillStyle = tone.fg;
    ctx.fill();
    ctx.textAlign = "left";
    ctx.textBaseline = "top";
    ctx.fillStyle = tone.fg;
    ctx.fillText(layout.delta, startX + arrowW + gap, y + layout.deltaSize * 0.12);
    ctx.textAlign = center ? "center" : "left";
    ctx.restore();
  }
}

/* ------------------------------------------------------------------ */
/* Checklist                                                           */
/* ------------------------------------------------------------------ */

interface ChecklistItem {
  label: string;
  detail?: string;
  state: "done" | "active" | "todo";
}

function checklistItemsOf(element: HyperframeElement): ChecklistItem[] {
  const props = propsOf(element);
  if (!Array.isArray(props.items)) return [];
  const items: ChecklistItem[] = [];
  for (const raw of props.items) {
    if (typeof raw === "string") {
      items.push({ label: raw, state: "done" });
    } else if (raw && typeof raw === "object") {
      const record = raw as Record<string, unknown>;
      if (typeof record.label !== "string") continue;
      const state = record.state === "active" || record.state === "todo" ? record.state : "done";
      items.push({
        label: record.label,
        detail: typeof record.detail === "string" ? record.detail : undefined,
        state,
      });
    }
  }
  return items;
}

function checklistMetrics(env: RenderEnv): { rowGap: number; labelSize: number; detailSize: number; circleR: number } {
  const base = Math.min(env.dims.width, env.dims.height);
  return {
    rowGap: Math.round(base * 0.02),
    labelSize: Math.round(base * 0.024),
    detailSize: Math.max(13, Math.round(base * 0.019)),
    circleR: Math.round(base * 0.0145),
  };
}

function checklistRowHeight(item: ChecklistItem, env: RenderEnv): number {
  const metrics = checklistMetrics(env);
  let height = Math.max(metrics.circleR * 2, metrics.labelSize * 1.3);
  if (item.detail) height += metrics.detailSize * 1.35;
  return height;
}

export function estimateChecklistHeight(
  _ctx: SKRSContext2D,
  element: HyperframeElement,
  _box: Box,
  env: RenderEnv,
): number {
  const items = checklistItemsOf(element);
  if (items.length === 0) return 0;
  const props = propsOf(element);
  const columns = typeof props.columns === "number" && props.columns > 1 ? Math.floor(props.columns) : 1;
  const metrics = checklistMetrics(env);
  const perColumn = Math.ceil(items.length / columns);
  let tallest = 0;
  for (let col = 0; col < columns; col++) {
    const columnItems = items.slice(col * perColumn, (col + 1) * perColumn);
    const height =
      columnItems.reduce((sum, item) => sum + checklistRowHeight(item, env), 0) +
      metrics.rowGap * Math.max(0, columnItems.length - 1);
    tallest = Math.max(tallest, height);
  }
  return tallest;
}

function drawCheckCircle(
  ctx: SKRSContext2D,
  cx: number,
  cy: number,
  r: number,
  state: ChecklistItem["state"],
  env: RenderEnv,
): void {
  if (state === "done") {
    ctx.beginPath();
    ctx.arc(cx, cy, r, 0, Math.PI * 2);
    ctx.fillStyle = env.palette.success;
    ctx.fill();
    ctx.beginPath();
    ctx.moveTo(cx - r * 0.42, cy + r * 0.02);
    ctx.lineTo(cx - r * 0.1, cy + r * 0.36);
    ctx.lineTo(cx + r * 0.46, cy - r * 0.3);
    ctx.strokeStyle = env.palette.isLight ? "#ffffff" : env.palette.bg;
    ctx.lineWidth = Math.max(2.5, r * 0.28);
    ctx.lineCap = "round";
    ctx.lineJoin = "round";
    ctx.stroke();
    ctx.lineCap = "butt";
    ctx.lineJoin = "miter";
    return;
  }
  if (state === "active") {
    const breathe = pulse01(env);
    ctx.beginPath();
    ctx.arc(cx, cy, r * (1 + breathe * 0.1), 0, Math.PI * 2);
    ctx.fillStyle = rgba(env.palette.accent, 0.14 + breathe * 0.08);
    ctx.fill();
    ctx.strokeStyle = env.palette.accent;
    ctx.lineWidth = 2.5;
    ctx.stroke();
    ctx.beginPath();
    ctx.arc(cx, cy, r * 0.38, 0, Math.PI * 2);
    ctx.fillStyle = env.palette.accent;
    ctx.fill();
    return;
  }
  ctx.beginPath();
  ctx.arc(cx, cy, r, 0, Math.PI * 2);
  ctx.strokeStyle = rgba(env.palette.fg, 0.28);
  ctx.lineWidth = 2;
  ctx.stroke();
}

export function drawChecklist(ctx: SKRSContext2D, element: HyperframeElement, box: Box, env: RenderEnv): void {
  const items = checklistItemsOf(element);
  if (items.length === 0) return;
  const props = propsOf(element);
  const columns = typeof props.columns === "number" && props.columns > 1 ? Math.floor(props.columns) : 1;
  const metrics = checklistMetrics(env);
  const base = Math.min(env.dims.width, env.dims.height);
  const colGap = Math.round(base * 0.035);
  const colW = (box.w - colGap * (columns - 1)) / columns;
  const perColumn = Math.ceil(items.length / columns);
  const totalH = estimateChecklistHeight(ctx, element, box, env);
  const startY = box.y + Math.max(0, (box.h - totalH) / 2);

  for (let col = 0; col < columns; col++) {
    const columnItems = items.slice(col * perColumn, (col + 1) * perColumn);
    const colX = box.x + col * (colW + colGap);
    let y = startY;
    for (let row = 0; row < columnItems.length; row++) {
      const item = columnItems[row]!;
      const rowH = checklistRowHeight(item, env);
      const circleCy = y + Math.max(metrics.circleR, metrics.labelSize * 0.65);
      // Rows check in one after another; circles pop with a slight overshoot.
      const rowT = enter01(env, 150 + (col * perColumn + row) * 110, 420);
      ctx.save();
      ctx.globalAlpha *= easeOutCubic(rowT);
      const circleScale = Math.max(0.01, easeOutBack(rowT));
      drawCheckCircle(ctx, colX + metrics.circleR, circleCy, metrics.circleR * circleScale, item.state, env);
      const textX = colX + metrics.circleR * 2 + Math.round(base * 0.016);
      const textW = Math.max(1, colX + colW - textX);
      ctx.font = fontFor(env, item.state === "active" ? "semibold" : "medium", metrics.labelSize);
      ctx.fillStyle = item.state === "todo" ? env.palette.subtle : env.palette.fg;
      ctx.textAlign = "left";
      ctx.textBaseline = "middle";
      ctx.fillText(truncateToWidth(ctx, item.label, textW), textX, circleCy);
      if (item.detail) {
        ctx.font = fontFor(env, "body", metrics.detailSize);
        ctx.fillStyle = env.palette.subtle;
        ctx.fillText(
          truncateToWidth(ctx, item.detail, textW),
          textX,
          circleCy + metrics.labelSize * 0.75 + metrics.detailSize * 0.62,
        );
      }
      ctx.restore();
      y += rowH + metrics.rowGap;
    }
  }
}

/* ------------------------------------------------------------------ */
/* Quote                                                               */
/* ------------------------------------------------------------------ */

interface QuoteLayout {
  lines: string[];
  attribution?: string;
  markSize: number;
  markGap: number;
  textSize: number;
  lineH: number;
  attrSize: number;
  attrGap: number;
  height: number;
}

function quoteLayout(ctx: SKRSContext2D, element: HyperframeElement, box: Box, env: RenderEnv): QuoteLayout {
  const props = propsOf(element);
  const base = Math.min(env.dims.width, env.dims.height);
  const text = typeof props.text === "string" ? props.text : "";
  const attribution = typeof props.attribution === "string" ? props.attribution : undefined;
  const markSize = Math.round(base * 0.085);
  const markGap = Math.round(base * 0.012);
  const textSize = Math.round(base * 0.036);
  const lineH = textSize * 1.32;
  const attrSize = Math.max(14, Math.round(base * 0.02));
  const attrGap = Math.round(base * 0.02);
  ctx.font = fontFor(env, "display", textSize);
  const lines = wrapText(ctx, text, Math.max(1, box.w)).slice(0, 3);
  let height = markSize * 0.52 + markGap + lines.length * lineH;
  if (attribution) height += attrGap + attrSize * 1.3;
  return { lines, attribution, markSize, markGap, textSize, lineH, attrSize, attrGap, height };
}

export function estimateQuoteHeight(ctx: SKRSContext2D, element: HyperframeElement, box: Box, env: RenderEnv): number {
  return quoteLayout(ctx, element, box, env).height;
}

export function drawQuote(ctx: SKRSContext2D, element: HyperframeElement, box: Box, env: RenderEnv): void {
  const layout = quoteLayout(ctx, element, box, env);
  let y = box.y + Math.max(0, (box.h - layout.height) / 2);
  ctx.textAlign = "left";
  ctx.textBaseline = "alphabetic";

  ctx.font = fontFor(env, "display", layout.markSize);
  ctx.fillStyle = rgba(env.palette.accent, 0.65);
  ctx.fillText("“", box.x - layout.markSize * 0.06, y + layout.markSize * 0.62);
  y += layout.markSize * 0.52 + layout.markGap;

  ctx.font = fontFor(env, "display", layout.textSize);
  ctx.fillStyle = env.palette.fg;
  ctx.textBaseline = "top";
  for (const line of layout.lines) {
    ctx.fillText(line, box.x, y + (layout.lineH - layout.textSize) / 2);
    y += layout.lineH;
  }

  if (layout.attribution) {
    y += layout.attrGap;
    ctx.font = fontFor(env, "medium", layout.attrSize);
    ctx.fillStyle = env.palette.subtle;
    ctx.fillText(`— ${layout.attribution}`, box.x, y);
  }
}

/* ------------------------------------------------------------------ */
/* TravelPath                                                          */
/* ------------------------------------------------------------------ */

interface TravelPoint {
  x: number;
  y: number;
  label?: string;
}

function travelPoint(raw: unknown): TravelPoint | undefined {
  if (!raw || typeof raw !== "object") return undefined;
  const record = raw as Record<string, unknown>;
  if (typeof record.x !== "number" || typeof record.y !== "number") return undefined;
  return {
    x: clamp01(record.x),
    y: clamp01(record.y),
    label: typeof record.label === "string" ? record.label : undefined,
  };
}

function quadPoint(p0: TravelPoint, cp: TravelPoint, p1: TravelPoint, t: number): { x: number; y: number } {
  const inv = 1 - t;
  return {
    x: inv * inv * p0.x + 2 * inv * t * cp.x + t * t * p1.x,
    y: inv * inv * p0.y + 2 * inv * t * cp.y + t * t * p1.y,
  };
}

function drawTravelLabel(
  ctx: SKRSContext2D,
  env: RenderEnv,
  label: string,
  x: number,
  y: number,
  below: boolean,
  base: number,
): void {
  const size = Math.max(13, Math.round(base * 0.019));
  ctx.font = fontFor(env, "semibold", size);
  setTracking(ctx, size * 0.1);
  ctx.textAlign = "center";
  ctx.textBaseline = below ? "top" : "bottom";
  ctx.fillStyle = env.palette.fg;
  ctx.fillText(label.toUpperCase(), x, y + (below ? base * 0.02 : -base * 0.02));
  setTracking(ctx, 0);
}

/**
 * An animated route between two normalized points: faint dashed full route,
 * a traveled accent line, endpoint markers with labels, and a moving marker
 * (paper plane by default) oriented along the path. `progress` is author-
 * driven (map it to a range for narration-synced travel) and defaults to an
 * automatic flight over the first two seconds of the scene.
 */
export function drawTravelPath(ctx: SKRSContext2D, element: HyperframeElement, box: Box, env: RenderEnv): void {
  const props = propsOf(element);
  const from = travelPoint(props.from);
  const to = travelPoint(props.to);
  if (!from || !to) return;
  const base = Math.min(env.dims.width, env.dims.height);

  const p0 = { ...from, x: box.x + from.x * box.w, y: box.y + from.y * box.h };
  const p1 = { ...to, x: box.x + to.x * box.w, y: box.y + to.y * box.h };
  const dx = p1.x - p0.x;
  const dy = p1.y - p0.y;
  const len = Math.hypot(dx, dy) || 1;
  const curve = typeof props.curve === "number" ? Math.max(-1, Math.min(1, props.curve)) : 0.35;
  // Perpendicular bend: positive curve arcs "over" a left-to-right route.
  const cp = {
    x: (p0.x + p1.x) / 2 + (dy / len) * len * 0.5 * curve,
    y: (p0.y + p1.y) / 2 - (dx / len) * len * 0.5 * curve,
  };

  const progress = typeof props.progress === "number" ? clamp01(props.progress) : easeOutCubic(enter01(env, 450, 2000));

  // Full route: quiet dashed guide.
  ctx.save();
  ctx.setLineDash([Math.max(4, base * 0.007), Math.max(6, base * 0.011)]);
  ctx.strokeStyle = rgba(env.palette.fg, 0.22);
  ctx.lineWidth = Math.max(2, base * 0.002);
  ctx.beginPath();
  ctx.moveTo(p0.x, p0.y);
  ctx.quadraticCurveTo(cp.x, cp.y, p1.x, p1.y);
  ctx.stroke();
  ctx.restore();

  // Traveled portion: sampled polyline with a soft glow pass underneath.
  if (progress > 0) {
    const steps = Math.max(2, Math.ceil(64 * progress));
    const passes: Array<{ width: number; style: string }> = [
      { width: Math.max(6, base * 0.008), style: rgba(env.palette.accent, 0.25) },
      { width: Math.max(3, base * 0.0038), style: env.palette.accent },
    ];
    for (const pass of passes) {
      ctx.beginPath();
      ctx.moveTo(p0.x, p0.y);
      for (let i = 1; i <= steps; i++) {
        const pt = quadPoint(p0, cp, p1, (i / steps) * progress);
        ctx.lineTo(pt.x, pt.y);
      }
      ctx.strokeStyle = pass.style;
      ctx.lineWidth = pass.width;
      ctx.lineCap = "round";
      ctx.lineJoin = "round";
      ctx.stroke();
    }
    ctx.lineCap = "butt";
    ctx.lineJoin = "miter";
  }

  // Endpoints: origin filled, destination ring that lights up on arrival.
  const dotR = Math.max(5, base * 0.006);
  ctx.beginPath();
  ctx.arc(p0.x, p0.y, dotR, 0, Math.PI * 2);
  ctx.fillStyle = env.palette.accent;
  ctx.fill();
  const arrived = progress >= 0.999;
  if (arrived) {
    const breathe = pulse01(env);
    ctx.beginPath();
    ctx.arc(p1.x, p1.y, dotR * (2 + breathe * 0.9), 0, Math.PI * 2);
    ctx.fillStyle = rgba(env.palette.accent2, 0.2 + breathe * 0.12);
    ctx.fill();
  }
  ctx.beginPath();
  ctx.arc(p1.x, p1.y, dotR, 0, Math.PI * 2);
  if (arrived) {
    ctx.fillStyle = env.palette.accent2;
    ctx.fill();
  } else {
    ctx.fillStyle = env.palette.bg;
    ctx.fill();
    ctx.strokeStyle = rgba(env.palette.fg, 0.5);
    ctx.lineWidth = 2;
    ctx.stroke();
  }
  if (p0.label) drawTravelLabel(ctx, env, p0.label, p0.x, p0.y, p0.y < box.y + box.h / 2, base);
  if (p1.label) drawTravelLabel(ctx, env, p1.label, p1.x, p1.y, p1.y < box.y + box.h / 2, base);

  // The traveler: a paper plane (or dot) oriented along the path tangent.
  const marker = props.marker === "dot" ? "dot" : "plane";
  if (progress > 0 && progress < 0.999) {
    const at = quadPoint(p0, cp, p1, progress);
    const ahead = quadPoint(p0, cp, p1, Math.min(1, progress + 0.02));
    const angle = Math.atan2(ahead.y - at.y, ahead.x - at.x);
    ctx.save();
    ctx.translate(at.x, at.y);
    if (marker === "dot") {
      ctx.beginPath();
      ctx.arc(0, 0, Math.max(6, base * 0.008), 0, Math.PI * 2);
      ctx.fillStyle = env.palette.fg;
      ctx.fill();
    } else {
      ctx.rotate(angle);
      const s = Math.max(12, base * 0.017);
      ctx.beginPath();
      ctx.arc(0, 0, s * 1.5, 0, Math.PI * 2);
      ctx.fillStyle = rgba(env.palette.accent, 0.18);
      ctx.fill();
      ctx.beginPath();
      ctx.moveTo(s, 0);
      ctx.lineTo(-s * 0.7, -s * 0.62);
      ctx.lineTo(-s * 0.3, 0);
      ctx.lineTo(-s * 0.7, s * 0.62);
      ctx.closePath();
      ctx.fillStyle = env.palette.fg;
      ctx.fill();
    }
    ctx.restore();
  }
}
