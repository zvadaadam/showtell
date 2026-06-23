import type { SKRSContext2D } from "@napi-rs/canvas";
import type { TalkingPointsScene } from "@agent-video/core";
import { THEME } from "../theme.ts";
import type { Dims } from "../dims.ts";
import { wrapText } from "../draw.ts";

export function drawTalkingPoints(ctx: SKRSContext2D, scene: TalkingPointsScene, dims: Dims): void {
  const { heading, points } = scene.content;
  const pad = Math.round(Math.min(dims.width, dims.height) * 0.09);
  const maxWidth = dims.width - pad * 2;
  const base = Math.min(dims.width, dims.height);

  ctx.textAlign = "left";
  ctx.textBaseline = "alphabetic";

  let y = pad + base * 0.06;

  if (heading) {
    const hSize = Math.round(base * 0.052);
    ctx.font = `${hSize}px '${THEME.sansBold}'`;
    ctx.fillStyle = THEME.fg;
    for (const line of wrapText(ctx, heading, maxWidth)) {
      ctx.fillText(line, pad, y);
      y += hSize * 1.25;
    }
    y += base * 0.03;
  }

  const ptSize = Math.round(base * 0.036);
  const lineH = ptSize * 1.35;
  const bulletGap = ptSize * 0.9;
  const indent = ptSize * 1.6;

  for (const point of points) {
    ctx.font = `${ptSize}px '${THEME.sans}'`;
    const lines = wrapText(ctx, point, maxWidth - indent);
    // bullet
    ctx.fillStyle = THEME.accent;
    ctx.beginPath();
    ctx.arc(pad + ptSize * 0.5, y - ptSize * 0.32, ptSize * 0.16, 0, Math.PI * 2);
    ctx.fill();
    // text
    ctx.fillStyle = THEME.fg;
    for (let i = 0; i < lines.length; i++) {
      ctx.fillText(lines[i]!, pad + indent, y);
      y += lineH;
    }
    y += bulletGap;
  }
}
