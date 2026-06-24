/** Render a single (Mode B) scene to a PNG buffer — deterministic. */
import { createCanvas } from "@napi-rs/canvas";
import type { Scene, AspectRatio } from "@agent-video/core";
import { resolveCodeRef, resolveDiff } from "@agent-video/core";
import { ensureFonts } from "./fonts.ts";
import { dimsFor } from "./dims.ts";
import { THEME } from "./theme.ts";
import { drawBackground, drawWatermark } from "./draw.ts";
import { drawTitle } from "./scenes/title.ts";
import { drawCode } from "./scenes/code.ts";
import { drawDiff } from "./scenes/diff.ts";
import { drawTalkingPoints } from "./scenes/talking-points.ts";
import { drawChart } from "./scenes/chart.ts";
import { tokenize } from "./highlight.ts";

/** Scene kinds compose can currently rasterize (grows over v1). */
export const COMPOSABLE_KINDS = ["title", "code", "diff", "talking-points", "chart"] as const;

export interface RenderSceneOpts {
  repoPath: string;
  aspectRatio: AspectRatio;
  /** Watermark text, or false to omit (premium). Default "agent-video.dev". */
  watermark?: string | false;
}

export interface RenderedScene {
  png: Buffer;
  width: number;
  height: number;
  /** Present for code scenes — the exact live bytes that were rendered. */
  resolved?: { file: string; text: string };
  /** Non-fatal warnings (e.g. a diff scene that resolved to no changes). */
  warning?: string;
}

export async function renderSceneToPng(scene: Scene, opts: RenderSceneOpts): Promise<RenderedScene> {
  ensureFonts();
  const dims = dimsFor(opts.aspectRatio);
  const canvas = createCanvas(dims.width, dims.height);
  const ctx = canvas.getContext("2d");
  drawBackground(ctx, dims);

  let resolved: RenderedScene["resolved"];
  let warning: string | undefined;
  switch (scene.kind) {
    case "title":
      drawTitle(ctx, scene, dims);
      break;
    case "code": {
      const r = resolveCodeRef(opts.repoPath, scene.content);
      const tokens = await tokenize(r.text, r.language, THEME.shikiTheme);
      drawCode(ctx, scene, r, tokens, dims);
      resolved = { file: scene.content.file, text: r.text };
      break;
    }
    case "diff": {
      const d = resolveDiff(opts.repoPath, scene.content);
      drawDiff(ctx, scene, d, dims);
      resolved = { file: scene.content.file, text: d.rawText };
      if (d.added === 0 && d.removed === 0) {
        warning = `diff scene for ${scene.content.file} at ref "${scene.content.ref}" is EMPTY (+0 −0). Note "A..B" excludes commit A — if the file changed in the base commit, widen the range.`;
      }
      break;
    }
    case "talking-points":
      drawTalkingPoints(ctx, scene, dims);
      break;
    case "chart":
      drawChart(ctx, scene, dims);
      break;
    default:
      throw new Error(`Scene kind "${scene.kind}" is not composable yet. v1a renders: ${COMPOSABLE_KINDS.join(", ")}.`);
  }

  if (opts.watermark !== false) {
    drawWatermark(ctx, dims, opts.watermark ?? "agent-video.dev");
  }

  return { png: canvas.toBuffer("image/png"), width: dims.width, height: dims.height, resolved, warning };
}

/** A full-frame transparent PNG with just the watermark — to overlay on video. */
export function renderWatermarkPng(aspectRatio: AspectRatio, text = "agent-video.dev"): Buffer {
  ensureFonts();
  const dims = dimsFor(aspectRatio);
  const canvas = createCanvas(dims.width, dims.height);
  const ctx = canvas.getContext("2d");
  drawWatermark(ctx, dims, text);
  return canvas.toBuffer("image/png");
}
