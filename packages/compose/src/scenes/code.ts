import type { SKRSContext2D } from "@napi-rs/canvas";
import type { CodeScene, ResolvedCode } from "@agent-video/core";
import { THEME } from "../theme.ts";
import type { Dims } from "../dims.ts";
import { fitMonoFont, windowAround, drawCard } from "../draw.ts";
import type { Tok } from "../highlight.ts";

/**
 * Draw a code card: a window-chrome bar with the file path, then line numbers
 * and Shiki-colored tokens. Focus lines get a highlight band. Long excerpts are
 * windowed to a legible line cap (centered on the focus line) with a "+N more
 * lines" footer — the font stays readable and never clips. The full requested
 * range is still read live for the contract sha; only the display is windowed.
 */
export function drawCode(
  ctx: SKRSContext2D,
  scene: CodeScene,
  resolved: ResolvedCode,
  tokens: Tok[][],
  dims: Dims,
): void {
  const { codeX, codeY, codeW, codeH, pad } = drawCard(ctx, dims, { file: scene.content.file });

  const innerPad = Math.round(pad * 0.6);
  const base = Math.min(dims.width, dims.height);

  // Window to a legible number of lines (a fixed card can't show 40 lines big),
  // anchored on the focus line. The full range is still read for the sha.
  const anchor = resolved.focus.length ? resolved.focus[0]! - resolved.startLine : 0;
  const { view, start, hiddenNote } = windowAround(tokens, anchor);
  const startLineNo = resolved.startLine + start;

  const gutterChars = String(startLineNo + view.length - 1).length + 2;
  const maxContent = Math.max(1, ...view.map((line) => line.reduce((n, t) => n + t.content.length, 0)));
  const noteH = hiddenNote ? Math.round(base * 0.03) : 0;
  const areaH = codeH - innerPad * 2 - noteH;
  const { fontSize, lineH } = fitMonoFont(ctx, {
    longestChars: gutterChars + maxContent,
    lineCount: view.length,
    areaW: codeW - innerPad * 2,
    areaH,
    maxFont: Math.round(base * 0.03),
    minFont: Math.round(base * 0.02),
    lineHeightRatio: 1.5,
    family: THEME.mono,
  });
  ctx.font = `${fontSize}px '${THEME.mono}'`;
  ctx.textAlign = "left";
  ctx.textBaseline = "middle";

  const gutterW = gutterChars * ctx.measureText("M").width;
  const startX = codeX + innerPad;
  const codeStartX = startX + gutterW;
  // Center the block vertically when it doesn't fill the card.
  const topOffset = Math.max(0, (areaH - view.length * lineH) / 2);
  let y = codeY + innerPad + topOffset + lineH / 2;

  const focus = new Set(resolved.focus);
  for (let i = 0; i < view.length; i++) {
    const absLine = startLineNo + i;
    if (focus.has(absLine)) {
      ctx.fillStyle = THEME.focus;
      ctx.fillRect(codeX, y - lineH / 2, codeW, lineH);
    }
    ctx.fillStyle = THEME.gutter;
    ctx.fillText(String(absLine), startX, y);
    let x = codeStartX;
    for (const tok of view[i]!) {
      ctx.fillStyle = tok.color;
      ctx.fillText(tok.content, x, y);
      x += ctx.measureText(tok.content).width;
    }
    y += lineH;
  }

  if (hiddenNote) {
    ctx.font = `${Math.round(noteH * 0.6)}px '${THEME.sans}'`;
    ctx.fillStyle = THEME.subtle;
    ctx.textAlign = "right";
    ctx.textBaseline = "bottom";
    ctx.fillText(hiddenNote, codeX + codeW - innerPad, codeY + codeH - innerPad * 0.4);
  }

  ctx.restore();
}
