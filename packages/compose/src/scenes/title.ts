import type { SKRSContext2D } from "@napi-rs/canvas";
import type { TitleScene } from "@showtell/core";
import { THEME, type CanvasTheme } from "../theme.ts";
import type { Dims } from "../dims.ts";
import { wrapText } from "../draw.ts";

export function drawTitle(ctx: SKRSContext2D, scene: TitleScene, dims: Dims, theme: CanvasTheme = THEME): void {
  const { heading, subtitle } = scene.content;
  const portrait = dims.height > dims.width;
  const maxWidth = dims.width * 0.82;
  const cx = dims.width / 2;

  const headSize = Math.round(portrait ? dims.width * 0.072 : dims.width * 0.05);
  const subSize = Math.round(headSize * 0.42);
  const headLineH = headSize * 1.18;
  const gap = headSize * 0.55;

  ctx.textAlign = "center";
  ctx.textBaseline = "middle";

  // Wrap heading
  ctx.font = `${headSize}px '${theme.sansBold}'`;
  const headLines = wrapText(ctx, heading, maxWidth);
  const subLines = subtitle ? wrapText(setFont(ctx, subSize, theme.sans), subtitle, maxWidth) : [];

  const totalH = headLines.length * headLineH + (subLines.length ? gap + subLines.length * subSize * 1.3 : 0);
  let y = dims.height / 2 - totalH / 2 + headLineH / 2;

  // Accent rule above
  ctx.fillStyle = theme.accent;
  const ruleW = headSize * 1.6;
  ctx.fillRect(cx - ruleW / 2, y - headLineH * 0.9, ruleW, Math.max(3, headSize * 0.06));

  ctx.font = `${headSize}px '${theme.sansBold}'`;
  ctx.fillStyle = theme.fg;
  for (const line of headLines) {
    ctx.fillText(line, cx, y);
    y += headLineH;
  }

  if (subLines.length) {
    y += gap - headLineH + subSize * 1.3 * 0.5;
    ctx.font = `${subSize}px '${theme.sans}'`;
    ctx.fillStyle = theme.subtle;
    for (const line of subLines) {
      ctx.fillText(line, cx, y);
      y += subSize * 1.3;
    }
  }
}

function setFont(ctx: SKRSContext2D, size: number, family: string): SKRSContext2D {
  ctx.font = `${size}px '${family}'`;
  return ctx;
}
