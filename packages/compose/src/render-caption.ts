import { createCanvas, type SKRSContext2D } from "@napi-rs/canvas";
import type { AspectRatio, ResolvedBundleTheme } from "@showtell/core";
import { dimsFor, type Dims } from "./dims.ts";
import { ensureFonts } from "./fonts.ts";
import { canvasTheme, THEME, type CanvasTheme } from "./theme.ts";
import { roundRect, wrapText } from "./draw.ts";

const CAPTION_FONT_SCALE = 0.032;
const CAPTION_PAD_X_SCALE = 0.045;
const CAPTION_PAD_Y_SCALE = 0.025;
const CAPTION_BOTTOM_MARGIN_SCALE = 0.09;
const CAPTION_LINE_HEIGHT = 1.25;
const CAPTION_MAX_LINES = 3;

/**
 * Renderer-owned captions occupy this bottom inset in the authored frame.
 * Keep this calculation beside `drawCaptionOverlay` so browser visuals and
 * the final compositor cannot silently disagree about the exclusion zone.
 */
export function captionSafeArea(dims: Dims): { top: number; right: number; bottom: number; left: number } {
  const unit = Math.min(dims.width, dims.height);
  const fontSize = Math.round(unit * CAPTION_FONT_SCALE);
  const padY = Math.round(unit * CAPTION_PAD_Y_SCALE);
  const lineH = Math.round(fontSize * CAPTION_LINE_HEIGHT);
  const bottom = Math.round(unit * CAPTION_BOTTOM_MARGIN_SCALE) + CAPTION_MAX_LINES * lineH + padY * 2;
  return { top: 0, right: 0, bottom, left: 0 };
}

/** Draw one narration line as a burn-in caption directly onto a frame's canvas. */
export function drawCaptionOverlay(ctx: SKRSContext2D, dims: Dims, text: string, theme: CanvasTheme = THEME): void {
  const unit = Math.min(dims.width, dims.height);
  const fontSize = Math.round(unit * CAPTION_FONT_SCALE);
  const padX = Math.round(unit * CAPTION_PAD_X_SCALE);
  const padY = Math.round(unit * CAPTION_PAD_Y_SCALE);
  const maxW = Math.round(dims.width * 0.78);
  ctx.font = `${fontSize}px '${theme.sansBold}', 'Inter Bold Greek', 'Noto Sans Math'`;
  ctx.textAlign = "center";
  ctx.textBaseline = "middle";
  const lines = wrapText(ctx, text, maxW).slice(0, CAPTION_MAX_LINES);
  if (lines.length === 0) return;
  const lineH = Math.round(fontSize * CAPTION_LINE_HEIGHT);
  const boxW = Math.min(
    dims.width - padX * 2,
    Math.max(...lines.map((line) => ctx.measureText(line).width)) + padX * 2,
  );
  const boxH = lines.length * lineH + padY * 2;
  const x = (dims.width - boxW) / 2;
  const y = dims.height - boxH - Math.round(unit * CAPTION_BOTTOM_MARGIN_SCALE);

  roundRect(ctx, x, y, boxW, boxH, Math.round(unit * 0.02));
  ctx.fillStyle = theme.captionBg;
  ctx.fill();
  ctx.strokeStyle = theme.cardBorder;
  ctx.lineWidth = 2;
  ctx.stroke();

  ctx.fillStyle = theme.captionFg;
  let textY = y + padY + lineH / 2;
  for (const line of lines) {
    ctx.fillText(line, dims.width / 2, textY);
    textY += lineH;
  }
}

/**
 * Render one narration line as a full-frame transparent caption PNG.
 * Screencap clips overlay these per line in ffmpeg, so caption geometry
 * stays identical to the per-frame web compositor above.
 */
export function renderCaptionPng(aspectRatio: AspectRatio, text: string, theme?: ResolvedBundleTheme): Buffer {
  ensureFonts();
  const dims = dimsFor(aspectRatio);
  const canvas = createCanvas(dims.width, dims.height);
  drawCaptionOverlay(canvas.getContext("2d"), dims, text, canvasTheme(theme));
  return canvas.toBuffer("image/png");
}
