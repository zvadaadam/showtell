import { createCanvas, loadImage } from "@napi-rs/canvas";
import type { AspectRatio } from "@agent-video/core";
import { ensureFonts } from "./fonts.ts";
import { dimsFor } from "./dims.ts";
import { THEME } from "./theme.ts";
import { roundRect, wrapText } from "./draw.ts";

/** Overlay one narration line as a burn-in caption on an already-rendered frame. */
export async function renderCaptionedFrame(basePng: Buffer, aspectRatio: AspectRatio, text: string): Promise<Buffer> {
  ensureFonts();
  const dims = dimsFor(aspectRatio);
  const canvas = createCanvas(dims.width, dims.height);
  const ctx = canvas.getContext("2d");
  const base = await loadImage(basePng);
  ctx.drawImage(base, 0, 0, dims.width, dims.height);

  const unit = Math.min(dims.width, dims.height);
  const fontSize = Math.round(unit * 0.032);
  const padX = Math.round(unit * 0.045);
  const padY = Math.round(unit * 0.025);
  const maxW = Math.round(dims.width * 0.78);
  ctx.font = `${fontSize}px '${THEME.sansBold}'`;
  ctx.textAlign = "center";
  ctx.textBaseline = "middle";
  const lines = wrapText(ctx, text, maxW).slice(0, 3);
  const lineH = Math.round(fontSize * 1.25);
  const boxW = Math.min(
    dims.width - padX * 2,
    Math.max(...lines.map((line) => ctx.measureText(line).width)) + padX * 2,
  );
  const boxH = lines.length * lineH + padY * 2;
  const x = (dims.width - boxW) / 2;
  const y = dims.height - boxH - Math.round(unit * 0.09);

  roundRect(ctx, x, y, boxW, boxH, Math.round(unit * 0.02));
  ctx.fillStyle = "rgba(7, 10, 18, 0.78)";
  ctx.fill();
  ctx.strokeStyle = "rgba(255, 255, 255, 0.18)";
  ctx.lineWidth = 2;
  ctx.stroke();

  ctx.fillStyle = THEME.fg;
  let textY = y + padY + lineH / 2;
  for (const line of lines) {
    ctx.fillText(line, dims.width / 2, textY);
    textY += lineH;
  }

  return canvas.toBuffer("image/png");
}
