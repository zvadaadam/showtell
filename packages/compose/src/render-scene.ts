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
import { tokenize } from "./highlight.ts";

/** Scene kinds compose can currently rasterize (grows over v1). */
export const COMPOSABLE_KINDS = ["title", "code", "diff"] as const;

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
}

export async function renderSceneToPng(scene: Scene, opts: RenderSceneOpts): Promise<RenderedScene> {
  ensureFonts();
  const dims = dimsFor(opts.aspectRatio);
  const canvas = createCanvas(dims.width, dims.height);
  const ctx = canvas.getContext("2d");
  drawBackground(ctx, dims);

  let resolved: RenderedScene["resolved"];
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
      break;
    }
    default:
      throw new Error(
        `Scene kind "${scene.kind}" is not composable yet. v1a renders: ${COMPOSABLE_KINDS.join(", ")}.`,
      );
  }

  if (opts.watermark !== false) {
    drawWatermark(ctx, dims, opts.watermark ?? "agent-video.dev");
  }

  return { png: canvas.toBuffer("image/png"), width: dims.width, height: dims.height, resolved };
}
