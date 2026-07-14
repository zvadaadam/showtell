import { createCanvas, loadImage } from "@napi-rs/canvas";
import type { AspectRatio, ResolvedBundleTheme } from "@showtell/core";
import { dimsFor } from "./dims.ts";
import { drawWatermark } from "./draw.ts";
import { ensureFonts } from "./fonts.ts";
import { drawCaptionOverlay } from "./render-caption.ts";
import { drawPresenterOverlay, type PresenterOverlayState } from "./presenter.ts";
import { canvasTheme } from "./theme.ts";

export interface FrameChromeOptions {
  aspectRatio: AspectRatio;
  theme?: ResolvedBundleTheme;
  watermark?: string | false;
  presenter?: PresenterOverlayState;
  caption?: string;
}

export interface CompositedFrame {
  png: Buffer;
  rgba: Buffer;
  width: number;
  height: number;
}

/** Decode a full-frame PNG to the raw RGBA format consumed by ffmpeg. */
export async function decodeFramePng(basePng: Buffer, aspectRatio: AspectRatio): Promise<CompositedFrame> {
  return renderFrameChrome(basePng, { aspectRatio, watermark: false });
}

/**
 * Apply renderer-owned chrome to authored pixels in one decode/composite pass.
 * Authored browser frames use this ordering: watermark, presenter, then an
 * optional burn-in caption.
 */
export async function renderFrameChrome(basePng: Buffer, opts: FrameChromeOptions): Promise<CompositedFrame> {
  ensureFonts();
  const dims = dimsFor(opts.aspectRatio);
  const canvas = createCanvas(dims.width, dims.height);
  const ctx = canvas.getContext("2d");
  ctx.drawImage(await loadImage(basePng), 0, 0, dims.width, dims.height);

  const theme = canvasTheme(opts.theme);
  if (opts.watermark !== false) drawWatermark(ctx, dims, opts.watermark ?? "showtell", theme);
  if (opts.presenter) {
    drawPresenterOverlay(ctx, { dims, theme: opts.theme }, opts.presenter);
  }
  if (opts.caption) drawCaptionOverlay(ctx, dims, opts.caption, theme);

  // Clone native canvas memory: callers retain frames for review deltas and
  // the backing allocation may otherwise be reused after this function exits.
  let rgba: Buffer | undefined;
  let png: Buffer | undefined;
  return {
    // Animated ffmpeg paths read only `rgba`; defer the comparatively costly
    // PNG encode until a still, thumbnail, or review sample actually asks.
    get png() {
      return (png ??= canvas.toBuffer("image/png"));
    },
    get rgba() {
      return (rgba ??= Buffer.from(canvas.data()));
    },
    width: dims.width,
    height: dims.height,
  };
}
