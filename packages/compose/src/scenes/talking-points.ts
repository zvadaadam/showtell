import type { SKRSContext2D } from "@napi-rs/canvas";
import type { TalkingPointsScene } from "@agent-video/core";
import { THEME, type CanvasTheme } from "../theme.ts";
import type { Dims } from "../dims.ts";
import { wrapText } from "../draw.ts";

export function drawTalkingPoints(
  ctx: SKRSContext2D,
  scene: TalkingPointsScene,
  dims: Dims,
  theme: CanvasTheme = THEME,
): void {
  const { heading, points } = scene.content;
  const pad = Math.round(Math.min(dims.width, dims.height) * 0.09);
  const maxWidth = dims.width - pad * 2;
  const base = Math.min(dims.width, dims.height);

  const hSize = Math.round(base * 0.052);
  const headLineH = hSize * 1.25;
  const headGap = base * 0.03;
  const ptSize = Math.round(base * 0.036);
  const lineH = ptSize * 1.35;
  const bulletGap = ptSize * 0.9;
  const indent = ptSize * 1.6;

  ctx.textAlign = "left";
  ctx.textBaseline = "alphabetic";

  // Pre-measure so the whole block can be vertically centered.
  ctx.font = `${hSize}px '${theme.sansBold}'`;
  const headLines = heading ? wrapText(ctx, heading, maxWidth) : [];
  ctx.font = `${ptSize}px '${theme.sans}'`;
  const pointLines = points.map((p) => wrapText(ctx, p, maxWidth - indent));

  const totalH =
    (headLines.length ? headLines.length * headLineH + headGap : 0) +
    pointLines.reduce((sum, lines) => sum + lines.length * lineH + bulletGap, 0);

  let y = Math.max(pad, (dims.height - totalH) / 2) + (headLines.length ? hSize : ptSize);

  if (headLines.length) {
    ctx.font = `${hSize}px '${theme.sansBold}'`;
    ctx.fillStyle = theme.fg;
    for (const line of headLines) {
      ctx.fillText(line, pad, y);
      y += headLineH;
    }
    y += headGap;
  }

  for (const lines of pointLines) {
    ctx.font = `${ptSize}px '${theme.sans}'`;
    // bullet
    ctx.fillStyle = theme.accent;
    ctx.beginPath();
    ctx.arc(pad + ptSize * 0.5, y - ptSize * 0.32, ptSize * 0.16, 0, Math.PI * 2);
    ctx.fill();
    // text
    ctx.fillStyle = theme.fg;
    for (const line of lines) {
      ctx.fillText(line, pad + indent, y);
      y += lineH;
    }
    y += bulletGap;
  }
}
