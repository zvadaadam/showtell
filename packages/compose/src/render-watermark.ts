import { createCanvas } from "@napi-rs/canvas";
import type { AspectRatio } from "@showtell/core";
import { dimsFor } from "./dims.ts";
import { drawWatermark } from "./draw.ts";
import { ensureFonts } from "./fonts.ts";

/** Full-frame transparent PNG used to overlay renderer-owned branding on media. */
export function renderWatermarkPng(aspectRatio: AspectRatio, text = "showtell"): Buffer {
  ensureFonts();
  const dims = dimsFor(aspectRatio);
  const canvas = createCanvas(dims.width, dims.height);
  drawWatermark(canvas.getContext("2d"), dims, text);
  return canvas.toBuffer("image/png");
}
