import { describe, expect, test } from "bun:test";
import { captionSafeArea, dimsFor } from "../src/index.ts";

describe("captionSafeArea", () => {
  test.each(["16:9", "9:16"] as const)("reserves the complete three-line caption zone for %s", (aspectRatio) => {
    const dims = dimsFor(aspectRatio);
    const unit = Math.min(dims.width, dims.height);
    const fontSize = Math.round(unit * 0.032);
    const padY = Math.round(unit * 0.025);
    const lineH = Math.round(fontSize * 1.25);
    const expectedBottom = Math.round(unit * 0.09) + lineH * 3 + padY * 2;

    expect(captionSafeArea(dims)).toEqual({ top: 0, right: 0, bottom: expectedBottom, left: 0 });
  });
});
