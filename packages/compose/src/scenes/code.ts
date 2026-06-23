import type { SKRSContext2D } from "@napi-rs/canvas";
import type { CodeScene, ResolvedCode } from "@agent-video/core";
import { THEME } from "../theme.ts";
import type { Dims } from "../dims.ts";
import { roundRect } from "../draw.ts";
import type { Tok } from "../highlight.ts";

/**
 * Draw a code card: a window-chrome bar with the file path, then line numbers
 * and Shiki-colored tokens. Focus lines get a highlight band. Long content is
 * clipped to the card (v1a: static still; scrolling/animation is v1b).
 */
export function drawCode(
  ctx: SKRSContext2D,
  scene: CodeScene,
  resolved: ResolvedCode,
  tokens: Tok[][],
  dims: Dims,
): void {
  const pad = Math.round(Math.min(dims.width, dims.height) * 0.05);
  const cardX = pad;
  const cardY = pad;
  const cardW = dims.width - pad * 2;
  const cardH = dims.height - pad * 2;
  const radius = Math.round(pad * 0.5);

  // Card + chrome
  ctx.save();
  roundRect(ctx, cardX, cardY, cardW, cardH, radius);
  ctx.fillStyle = THEME.codeBg;
  ctx.fill();
  ctx.strokeStyle = THEME.cardBorder;
  ctx.lineWidth = 2;
  ctx.stroke();

  const barH = Math.round(Math.min(dims.width, dims.height) * 0.055);
  roundRect(ctx, cardX, cardY, cardW, barH, radius);
  ctx.fillStyle = THEME.codeBar;
  ctx.fill();
  // traffic dots
  const dotR = barH * 0.12;
  const dotY = cardY + barH / 2;
  const dots = ["#ff5f57", "#febc2e", "#28c840"];
  dots.forEach((c, i) => {
    ctx.beginPath();
    ctx.arc(cardX + pad * 0.5 + i * dotR * 3, dotY, dotR, 0, Math.PI * 2);
    ctx.fillStyle = c;
    ctx.fill();
  });
  // file path label
  ctx.font = `${Math.round(barH * 0.34)}px '${THEME.mono}'`;
  ctx.fillStyle = THEME.subtle;
  ctx.textAlign = "center";
  ctx.textBaseline = "middle";
  ctx.fillText(scene.content.file, cardX + cardW / 2, dotY);

  // Code area clip
  const codeX = cardX;
  const codeY = cardY + barH;
  const codeW = cardW;
  const codeH = cardH - barH;
  ctx.beginPath();
  ctx.rect(codeX, codeY, codeW, codeH);
  ctx.clip();

  const fontSize = Math.round(Math.min(dims.width, dims.height) * 0.026);
  const lineH = Math.round(fontSize * 1.5);
  ctx.font = `${fontSize}px '${THEME.mono}'`;
  ctx.textAlign = "left";
  ctx.textBaseline = "middle";

  const innerPad = Math.round(pad * 0.6);
  const gutterW = ctx.measureText(String(resolved.endLine).padStart(2, " ") + "  ").width;
  const startX = codeX + innerPad;
  const codeStartX = startX + gutterW;
  let y = codeY + innerPad + lineH / 2;

  const focus = new Set(resolved.focus);

  for (let i = 0; i < tokens.length; i++) {
    const absLine = resolved.startLine + i;
    if (focus.has(absLine)) {
      ctx.fillStyle = THEME.focus;
      ctx.fillRect(codeX, y - lineH / 2, codeW, lineH);
    }
    // line number
    ctx.fillStyle = THEME.gutter;
    ctx.fillText(String(absLine), startX, y);
    // tokens
    let x = codeStartX;
    for (const tok of tokens[i]!) {
      ctx.fillStyle = tok.color;
      ctx.fillText(tok.content, x, y);
      x += ctx.measureText(tok.content).width;
    }
    y += lineH;
    if (y > codeY + codeH) break;
  }

  ctx.restore();
}
