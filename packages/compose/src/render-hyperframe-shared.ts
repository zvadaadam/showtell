import type { HyperframeElement } from "@agent-video/hyperframes";
import type { RenderedScene } from "./render-scene.ts";

export interface Box {
  x: number;
  y: number;
  w: number;
  h: number;
}

export interface DrawResult {
  resolvedRefs: RenderedScene["resolvedRefs"];
  warning?: string;
}

export function propsOf(element: HyperframeElement): Record<string, unknown> {
  return element.props as Record<string, unknown>;
}

export function panelRadius(box: Box, scale = 0.035): number {
  return Math.min(18, Math.round(Math.min(box.w, box.h) * scale));
}

export function emptyResult(): DrawResult {
  return { resolvedRefs: [] };
}
