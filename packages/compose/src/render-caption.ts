import { createCanvas, loadImage, type SKRSContext2D } from "@napi-rs/canvas";
import type { AspectRatio } from "@showtell/core";
import { ensureFonts } from "./fonts.ts";
import { dimsFor, type Dims } from "./dims.ts";
import { THEME, type CanvasTheme } from "./theme.ts";
import { roundRect, wrapText } from "./draw.ts";

/** Draw one narration line as a burn-in caption directly onto a frame's canvas. */
export function drawCaptionOverlay(ctx: SKRSContext2D, dims: Dims, text: string, theme: CanvasTheme = THEME): void {
  const unit = Math.min(dims.width, dims.height);
  const fontSize = Math.round(unit * 0.032);
  const padX = Math.round(unit * 0.045);
  const padY = Math.round(unit * 0.025);
  const maxW = Math.round(dims.width * 0.78);
  ctx.font = `${fontSize}px '${theme.sansBold}', 'Inter Bold Greek', 'Noto Sans Math'`;
  ctx.textAlign = "center";
  ctx.textBaseline = "middle";
  const lines = wrapText(ctx, text, maxW).slice(0, 3);
  if (lines.length === 0) return;
  const lineH = Math.round(fontSize * 1.25);
  const boxW = Math.min(
    dims.width - padX * 2,
    Math.max(...lines.map((line) => ctx.measureText(line).width)) + padX * 2,
  );
  const boxH = lines.length * lineH + padY * 2;
  const x = (dims.width - boxW) / 2;
  const y = dims.height - boxH - Math.round(unit * 0.09);

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

/** Overlay one narration line as a burn-in caption on an already-rendered frame. */
export async function renderCaptionedFrame(
  basePng: Buffer,
  aspectRatio: AspectRatio,
  text: string,
  theme: CanvasTheme = THEME,
): Promise<Buffer> {
  ensureFonts();
  const dims = dimsFor(aspectRatio);
  const canvas = createCanvas(dims.width, dims.height);
  const ctx = canvas.getContext("2d");
  const base = await loadImage(basePng);
  ctx.drawImage(base, 0, 0, dims.width, dims.height);
  drawCaptionOverlay(ctx, dims, text, theme);
  return canvas.toBuffer("image/png");
}
