/** Shared canvas drawing helpers: background, watermark, text wrapping, cards. */
import type { SKRSContext2D } from "@napi-rs/canvas";
import { THEME, type CanvasTheme } from "./theme.ts";
import type { Dims } from "./dims.ts";

export function drawBackground(ctx: SKRSContext2D, dims: Dims, theme: CanvasTheme = THEME): void {
  const g = ctx.createLinearGradient(0, 0, dims.width, dims.height);
  g.addColorStop(0, theme.bg[0]);
  g.addColorStop(1, theme.bg[1]);
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, dims.width, dims.height);
}

export function drawWatermark(ctx: SKRSContext2D, dims: Dims, text: string, theme: CanvasTheme = THEME): void {
  const size = Math.round(Math.min(dims.width, dims.height) * 0.022);
  ctx.font = `${size}px '${theme.sans}'`;
  ctx.fillStyle = theme.watermarkFg;
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

/** A fixed card can't show many lines legibly, so repo text primitives window to this many. */
export const MAX_WINDOW_LINES = 22;

/**
 * Window a long line array down to `max` lines around an anchor (the focus line
 * for code, the first change for a diff), biased so the anchor sits in the top
 * third (more context follows). Returns the slice, its start offset, and a
 * "+N more lines" footer string (empty when nothing is hidden). Shared by the
 * code and diff primitives so the windowing rule lives in one place.
 */
export function windowAround<T>(
  items: T[],
  anchor: number,
  max: number = MAX_WINDOW_LINES,
): { view: T[]; start: number; hiddenNote: string } {
  if (items.length <= max) return { view: items, start: 0, hiddenNote: "" };
  const start = Math.max(0, Math.min(items.length - max, anchor - Math.floor(max / 3)));
  const view = items.slice(start, start + max);
  const hidden = items.length - view.length;
  return { view, start, hiddenNote: `+${hidden} more line${hidden > 1 ? "s" : ""}` };
}

/**
 * Pick a monospace font size so `lineCount` lines of up to `longestChars`
 * characters fit within areaW × areaH — prevents code/diff clipping (bottom and
 * right edge). Monospace ⇒ uniform char width, so this is exact.
 */
export function fitMonoFont(
  ctx: SKRSContext2D,
  opts: {
    longestChars: number;
    lineCount: number;
    areaW: number;
    areaH: number;
    maxFont: number;
    lineHeightRatio: number;
    family: string;
    minFont?: number;
  },
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
export function roundRect(ctx: SKRSContext2D, x: number, y: number, w: number, h: number, r: number): void {
  const radius = Math.min(r, w / 2, h / 2);
  ctx.beginPath();
  ctx.moveTo(x + radius, y);
  ctx.arcTo(x + w, y, x + w, y + h, radius);
  ctx.arcTo(x + w, y + h, x, y + h, radius);
  ctx.arcTo(x, y + h, x, y, radius);
  ctx.arcTo(x, y, x + w, y, radius);
  ctx.closePath();
}

/** A right-aligned, colored title-bar badge segment (e.g. diff "+N" / "−M"). */
export interface CardBadge {
  text: string;
  color: string;
}

/** The inner geometry a card returns for the caller to draw content into. */
export interface CardChrome {
  codeX: number;
  codeY: number;
  codeW: number;
  codeH: number;
  pad: number;
  barH: number;
}

/**
 * Draw the shared code/diff card: a rounded panel, a window-chrome title bar
 * (traffic dots + centered file path + optional right-aligned badge), and clip
 * to the code area. Calls `ctx.save()`; the caller draws content and `ctx.restore()`s.
 * One chrome for code and diff so they read as the same component.
 */
export function drawCard(
  ctx: SKRSContext2D,
  dims: Dims,
  opts: { file: string; badge?: CardBadge[] },
  theme: CanvasTheme = THEME,
): CardChrome {
  const base = Math.min(dims.width, dims.height);
  const pad = Math.round(base * 0.05);
  const cardX = pad;
  const cardY = pad;
  const cardW = dims.width - pad * 2;
  const cardH = dims.height - pad * 2;
  const radius = Math.round(pad * 0.5);

  ctx.save();
  roundRect(ctx, cardX, cardY, cardW, cardH, radius);
  ctx.fillStyle = theme.codeBg;
  ctx.fill();
  ctx.strokeStyle = theme.cardBorder;
  ctx.lineWidth = 2;
  ctx.stroke();

  const barH = Math.round(base * 0.055);
  roundRect(ctx, cardX, cardY, cardW, barH, radius);
  ctx.fillStyle = theme.codeBar;
  ctx.fill();

  const dotR = barH * 0.12;
  const dotY = cardY + barH / 2;
  ["#ff5f57", "#febc2e", "#28c840"].forEach((c, i) => {
    ctx.beginPath();
    ctx.arc(cardX + pad * 0.5 + i * dotR * 3, dotY, dotR, 0, Math.PI * 2);
    ctx.fillStyle = c;
    ctx.fill();
  });

  ctx.font = `${Math.round(barH * 0.34)}px '${theme.mono}'`;
  ctx.textBaseline = "middle";
  if (opts.badge) {
    // right-aligned, drawn right→left so segments read left→right
    ctx.textAlign = "right";
    let rightX = cardX + cardW - pad * 0.6;
    for (let i = opts.badge.length - 1; i >= 0; i--) {
      const seg = opts.badge[i]!;
      ctx.fillStyle = seg.color;
      ctx.fillText(seg.text, rightX, dotY);
      rightX -= ctx.measureText(seg.text).width;
    }
  }
  ctx.textAlign = "center";
  ctx.fillStyle = theme.subtle;
  ctx.fillText(opts.file, cardX + cardW / 2, dotY);

  const codeY = cardY + barH;
  const codeH = cardH - barH;
  ctx.beginPath();
  ctx.rect(cardX, codeY, cardW, codeH);
  ctx.clip();

  return { codeX: cardX, codeY, codeW: cardW, codeH, pad, barH };
}
