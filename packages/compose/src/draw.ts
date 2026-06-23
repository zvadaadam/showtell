/** Shared canvas drawing helpers: background, watermark, text wrapping, cards. */
import type { SKRSContext2D } from "@napi-rs/canvas";
import { THEME } from "./theme.ts";
import type { Dims } from "./dims.ts";

export function drawBackground(ctx: SKRSContext2D, dims: Dims): void {
  const g = ctx.createLinearGradient(0, 0, dims.width, dims.height);
  g.addColorStop(0, THEME.bg[0]);
  g.addColorStop(1, THEME.bg[1]);
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, dims.width, dims.height);
}

export function drawWatermark(ctx: SKRSContext2D, dims: Dims, text: string): void {
  const size = Math.round(Math.min(dims.width, dims.height) * 0.022);
  ctx.font = `${size}px '${THEME.sans}'`;
  ctx.fillStyle = THEME.watermarkFg;
  ctx.textAlign = "right";
  ctx.textBaseline = "alphabetic";
  const pad = Math.round(size * 1.4);
  ctx.fillText(text, dims.width - pad, dims.height - pad);
}

/** Greedy word-wrap to a max pixel width. Caller sets ctx.font first. */
export function wrapText(ctx: SKRSContext2D, text: string, maxWidth: number): string[] {
  const words = text.split(/\s+/);
  const lines: string[] = [];
  let line = "";
  for (const w of words) {
    const candidate = line ? `${line} ${w}` : w;
    if (ctx.measureText(candidate).width > maxWidth && line) {
      lines.push(line);
      line = w;
    } else {
      line = candidate;
    }
  }
  if (line) lines.push(line);
  return lines;
}

/**
 * Pick a monospace font size so `lineCount` lines of up to `longestChars`
 * characters fit within areaW × areaH — prevents code/diff clipping (bottom and
 * right edge). Monospace ⇒ uniform char width, so this is exact.
 */
export function fitMonoFont(
  ctx: SKRSContext2D,
  opts: { longestChars: number; lineCount: number; areaW: number; areaH: number; maxFont: number; lineHeightRatio: number; family: string; minFont?: number },
): { fontSize: number; lineH: number } {
  const probe = 100;
  ctx.font = `${probe}px '${opts.family}'`;
  const charWPerPx = ctx.measureText("M").width / probe;
  const minFont = opts.minFont ?? 12;
  const byWidth = opts.longestChars > 0 ? opts.areaW / (opts.longestChars * charWPerPx) : opts.maxFont;
  const byHeight = opts.lineCount > 0 ? opts.areaH / (opts.lineCount * opts.lineHeightRatio) : opts.maxFont;
  // Prefer filling the height (keeps the font readable); only shrink for very
  // long lines, and never below a readable minimum (rare long lines then clip).
  let fontSize = Math.min(opts.maxFont, byHeight);
  if (byWidth < fontSize) fontSize = Math.max(minFont, byWidth);
  fontSize = Math.max(minFont, Math.min(opts.maxFont, fontSize));
  return { fontSize, lineH: fontSize * opts.lineHeightRatio };
}

/** Rounded-rect path (canvas has roundRect, but keep it explicit for older builds). */
export function roundRect(
  ctx: SKRSContext2D,
  x: number,
  y: number,
  w: number,
  h: number,
  r: number,
): void {
  const radius = Math.min(r, w / 2, h / 2);
  ctx.beginPath();
  ctx.moveTo(x + radius, y);
  ctx.arcTo(x + w, y, x + w, y + h, radius);
  ctx.arcTo(x + w, y + h, x, y + h, radius);
  ctx.arcTo(x, y + h, x, y, radius);
  ctx.arcTo(x, y, x + w, y, radius);
  ctx.closePath();
}
