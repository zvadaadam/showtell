/** Small canvas helpers used only by renderer-owned presentation chrome. */
import type { SKRSContext2D } from "@napi-rs/canvas";
import type { Dims } from "./dims.ts";
import { THEME, type CanvasTheme } from "./theme.ts";

export function drawWatermark(ctx: SKRSContext2D, dims: Dims, text: string, theme: CanvasTheme = THEME): void {
  const size = Math.round(Math.min(dims.width, dims.height) * 0.022);
  ctx.font = `${size}px '${theme.sans}'`;
  ctx.fillStyle = theme.watermarkFg;
  ctx.textAlign = "right";
  ctx.textBaseline = "alphabetic";
  const pad = Math.round(size * 1.4);
  ctx.fillText(text, dims.width - pad, dims.height - pad);
}

export function wrapText(ctx: SKRSContext2D, text: string, maxWidth: number): string[] {
  const words = text.split(/\s+/);
  const lines: string[] = [];
  let line = "";
  for (const word of words) {
    const candidate = line ? `${line} ${word}` : word;
    if (ctx.measureText(candidate).width > maxWidth && line) {
      lines.push(line);
      line = word;
    } else {
      line = candidate;
    }
  }
  if (line) lines.push(line);
  return lines;
}

export function roundRect(
  ctx: SKRSContext2D,
  x: number,
  y: number,
  width: number,
  height: number,
  radius: number,
): void {
  const r = Math.min(radius, width / 2, height / 2);
  ctx.beginPath();
  ctx.moveTo(x + r, y);
  ctx.arcTo(x + width, y, x + width, y + height, r);
  ctx.arcTo(x + width, y + height, x, y + height, r);
  ctx.arcTo(x, y + height, x, y, r);
  ctx.arcTo(x, y, x + width, y, r);
  ctx.closePath();
}
