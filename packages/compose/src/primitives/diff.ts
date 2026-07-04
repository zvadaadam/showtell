import type { SKRSContext2D } from "@napi-rs/canvas";
import type { DiffScene, ResolvedDiff } from "@agent-video/core";
import { THEME, type CanvasTheme } from "../theme.ts";
import type { Dims } from "../dims.ts";
import { fitMonoFont, windowAround, drawCard } from "../draw.ts";

const ADD_BG = "rgba(46,160,67,0.18)";
const DEL_BG = "rgba(248,81,73,0.18)";
const ADD_FG = "#7ee787";
const DEL_FG = "#ff9492";
const CONTEXT_FG = "#b8bdca";
const HUNK_FG = "#7c8cff";

export interface DiffDrawOptions {
  focus?: "file" | "changed" | number[];
  reveal?: number;
  theme?: CanvasTheme;
}

/** Draw a unified-diff card from real `git diff` bytes. */
export function drawDiff(
  ctx: SKRSContext2D,
  scene: DiffScene,
  diff: ResolvedDiff,
  dims: Dims,
  opts: DiffDrawOptions = {},
): void {
  const theme = opts.theme ?? THEME;
  const { codeX, codeY, codeW, codeH, pad } = drawCard(
    ctx,
    dims,
    {
      file: scene.content.file,
      badge: [
        { text: `+${diff.added}`, color: ADD_FG },
        { text: ` −${diff.removed}`, color: DEL_FG },
      ],
    },
    theme,
  );

  const innerPad = Math.round(pad * 0.5);
  // Window long diffs to a legible cap, anchored on the first actual change —
  // the +/- lines are the whole point of a diff scene, not the leading context.
  const base = Math.min(dims.width, dims.height);
  const firstChange = diff.lines.findIndex((l) => l.kind === "add" || l.kind === "del");
  const focusLine = Array.isArray(opts.focus) ? opts.focus[0] : undefined;
  const anchor = opts.focus === "file" ? 0 : typeof focusLine === "number" ? focusLine : firstChange;
  const windowed = windowAround(diff.lines, anchor < 0 ? 0 : anchor);
  const reveal = typeof opts.reveal === "number" ? Math.max(0, Math.min(1, opts.reveal)) : undefined;
  const visibleCount =
    reveal === undefined ? windowed.view.length : Math.max(1, Math.ceil(windowed.view.length * reveal));
  const view = windowed.view.slice(0, visibleCount);
  const hiddenByWindow = diff.lines.length - windowed.view.length;
  const hiddenByReveal = windowed.view.length - view.length;
  const hidden = hiddenByWindow + hiddenByReveal;
  const hiddenNote = hidden > 0 ? `+${hidden} more line${hidden > 1 ? "s" : ""}` : "";

  const longestChars = 2 + Math.max(1, ...view.map((l) => l.content.length));
  const noteH = hiddenNote ? Math.round(base * 0.03) : 0;
  const areaH = codeH - innerPad * 2 - noteH;
  const { fontSize, lineH } = fitMonoFont(ctx, {
    longestChars,
    lineCount: view.length,
    areaW: codeW - innerPad * 2,
    areaH,
    // Absolute floors keep diffs legible when the card renders into a small
    // grid cell (sub-canvas base can be a few hundred px).
    maxFont: Math.max(15, Math.round(base * 0.028)),
    minFont: Math.max(12, Math.round(base * 0.02)),
    lineHeightRatio: 1.5,
    family: theme.mono,
  });
  ctx.font = `${fontSize}px '${theme.mono}'`;
  ctx.textAlign = "left";

  const markerX = codeX + innerPad;
  const textX = markerX + ctx.measureText("M").width * 2;
  const topOffset = Math.max(0, (areaH - view.length * lineH) / 2);
  let y = codeY + innerPad + topOffset + lineH / 2;

  for (const line of view) {
    if (line.kind === "add" || line.kind === "del") {
      ctx.fillStyle = line.kind === "add" ? ADD_BG : DEL_BG;
      ctx.fillRect(codeX, y - lineH / 2, codeW, lineH);
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

  if (hiddenNote) {
    ctx.font = `${Math.round(noteH * 0.6)}px '${theme.sans}'`;
    ctx.fillStyle = theme.subtle;
    ctx.textAlign = "right";
    ctx.textBaseline = "bottom";
    ctx.fillText(hiddenNote, codeX + codeW - innerPad, codeY + codeH - innerPad * 0.4);
  }

  ctx.restore();
}
