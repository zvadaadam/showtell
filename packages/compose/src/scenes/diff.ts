import type { SKRSContext2D } from "@napi-rs/canvas";
import type { DiffScene, ResolvedDiff } from "@agent-video/core";
import { THEME } from "../theme.ts";
import type { Dims } from "../dims.ts";
import { roundRect } from "../draw.ts";

const ADD_BG = "rgba(46,160,67,0.18)";
const DEL_BG = "rgba(248,81,73,0.18)";
const ADD_FG = "#7ee787";
const DEL_FG = "#ff9492";
const CONTEXT_FG = "#b8bdca";
const HUNK_FG = "#7c8cff";

/** Draw a unified-diff card (read from real `git diff`). Static (v1a); animated
 *  Shiki Magic Move is the HTML-engine upgrade. */
export function drawDiff(ctx: SKRSContext2D, scene: DiffScene, diff: ResolvedDiff, dims: Dims): void {
  const pad = Math.round(Math.min(dims.width, dims.height) * 0.05);
  const cardX = pad;
  const cardY = pad;
  const cardW = dims.width - pad * 2;
  const cardH = dims.height - pad * 2;
  const radius = Math.round(pad * 0.5);

  ctx.save();
  roundRect(ctx, cardX, cardY, cardW, cardH, radius);
  ctx.fillStyle = THEME.codeBg;
  ctx.fill();
  ctx.strokeStyle = THEME.cardBorder;
  ctx.lineWidth = 2;
  ctx.stroke();

  // Title bar: file path + "+N -M"
  const barH = Math.round(Math.min(dims.width, dims.height) * 0.055);
  roundRect(ctx, cardX, cardY, cardW, barH, radius);
  ctx.fillStyle = THEME.codeBar;
  ctx.fill();
  ctx.textBaseline = "middle";
  ctx.font = `${Math.round(barH * 0.34)}px '${THEME.mono}'`;
  ctx.textAlign = "left";
  ctx.fillStyle = THEME.subtle;
  ctx.fillText(scene.content.file, cardX + pad * 0.6, cardY + barH / 2);
  ctx.textAlign = "right";
  ctx.fillStyle = ADD_FG;
  const summary = `+${diff.added}`;
  const delSummary = ` −${diff.removed}`;
  const delW = ctx.measureText(delSummary).width;
  ctx.fillStyle = DEL_FG;
  ctx.fillText(delSummary, cardX + cardW - pad * 0.6, cardY + barH / 2);
  ctx.fillStyle = ADD_FG;
  ctx.fillText(summary, cardX + cardW - pad * 0.6 - delW, cardY + barH / 2);

  // Code area
  const codeY = cardY + barH;
  const codeH = cardH - barH;
  ctx.beginPath();
  ctx.rect(cardX, codeY, cardW, codeH);
  ctx.clip();

  const fontSize = Math.round(Math.min(dims.width, dims.height) * 0.024);
  const lineH = Math.round(fontSize * 1.5);
  ctx.font = `${fontSize}px '${THEME.mono}'`;
  ctx.textAlign = "left";

  const innerPad = Math.round(pad * 0.5);
  const markerX = cardX + innerPad;
  const textX = markerX + ctx.measureText("+ ").width;
  let y = codeY + innerPad + lineH / 2;

  for (const line of diff.lines) {
    if (y > codeY + codeH) break;
    if (line.kind === "add" || line.kind === "del") {
      ctx.fillStyle = line.kind === "add" ? ADD_BG : DEL_BG;
      ctx.fillRect(cardX, y - lineH / 2, cardW, lineH);
    }
    let marker = " ";
    let fg = CONTEXT_FG;
    if (line.kind === "add") {
      marker = "+";
      fg = ADD_FG;
    } else if (line.kind === "del") {
      marker = "−";
      fg = DEL_FG;
    } else if (line.kind === "hunk") {
      fg = HUNK_FG;
    }
    ctx.fillStyle = fg;
    if (line.kind === "hunk") {
      ctx.fillText(line.content ? `@@ ${line.content}` : "@@", markerX, y);
    } else {
      ctx.fillText(marker, markerX, y);
      ctx.fillText(line.content, textX, y);
    }
    y += lineH;
  }

  ctx.restore();
}
