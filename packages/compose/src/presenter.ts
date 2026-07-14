/** Renderer-owned presenter bubble and its authored-frame exclusion area. */
import { readFileSync } from "node:fs";
import { createCanvas, loadImage, type Image, type SKRSContext2D } from "@napi-rs/canvas";
import { resolveBundleTheme, type ResolvedBundleTheme } from "@showtell/core";
import type { AspectRatio } from "@showtell/core";
import { resolveAgentLogo } from "./agent-logos.ts";
import { ensureFonts } from "./fonts.ts";
import { dimsFor, type Dims } from "./dims.ts";

export type PresenterPosition = "auto" | "top-left" | "top-center" | "top-right" | "bottom-left" | "bottom-right";
export type PresenterSize = "sm" | "md" | "lg";

const PRESENTER = {
  diameter: { sm: 0.105, md: 0.135, lg: 0.175 },
  margin: 0.04,
  ringRest: 1.06,
  ringAmplitude: 0.1,
  ringWidth: 0.045,
  haloRest: 1.1,
  haloAmplitude: 0.38,
  badgeScale: 0.38,
  badgeOffset: 0.74,
} as const;

export interface LoadedPresenter {
  avatar: Image;
  logo?: Image;
  monogram?: string;
  position: PresenterPosition;
  size: PresenterSize;
}

export interface PresenterOverlayState extends LoadedPresenter {
  amplitude: number;
}

export async function loadPresenterOverlay(opts: {
  imagePath: string;
  logoPath?: string;
  model?: string;
  position: PresenterPosition;
  size: PresenterSize;
}): Promise<LoadedPresenter> {
  const logoPath = opts.logoPath ?? resolveAgentLogo(opts.model)?.path;
  return {
    avatar: await loadImage(opts.imagePath),
    logo: logoPath ? await loadImage(readFileSync(logoPath)) : undefined,
    monogram: opts.model?.trim() ? opts.model.trim()[0]!.toUpperCase() : undefined,
    position: opts.position,
    size: opts.size,
  };
}

function clamp01(value: number): number {
  return Math.max(0, Math.min(1, value));
}

function rgba(hex: string, opacity: number): string {
  const match = /^#([0-9a-f]{2})([0-9a-f]{2})([0-9a-f]{2})$/i.exec(hex);
  if (!match) return hex;
  return `rgba(${Number.parseInt(match[1]!, 16)}, ${Number.parseInt(match[2]!, 16)}, ${Number.parseInt(match[3]!, 16)}, ${opacity})`;
}

function resolvePosition(position: PresenterPosition, dims: Dims): Exclude<PresenterPosition, "auto"> {
  if (position !== "auto") return position;
  return dims.width >= dims.height ? "top-right" : "top-center";
}

function bubbleCenter(position: Exclude<PresenterPosition, "auto">, dims: Dims, radius: number, margin: number) {
  const x =
    position === "top-center"
      ? dims.width / 2
      : position.endsWith("left")
        ? margin + radius
        : dims.width - margin - radius;
  const y = position.startsWith("top") ? margin + radius : dims.height - margin - radius;
  return { x, y };
}

export interface PresenterSafeArea {
  top: number;
  right: number;
  bottom: number;
  left: number;
  position: Exclude<PresenterPosition, "auto">;
}

export function presenterSafeArea(position: PresenterPosition, size: PresenterSize, dims: Dims): PresenterSafeArea {
  const resolved = resolvePosition(position, dims);
  const base = Math.min(dims.width, dims.height);
  const diameter = base * PRESENTER.diameter[size];
  const radius = diameter / 2;
  const margin = base * PRESENTER.margin;
  const haloRadius = radius * (PRESENTER.haloRest + PRESENTER.haloAmplitude);
  const inset = Math.ceil(margin + radius + haloRadius);
  return {
    top: resolved.startsWith("top") ? inset : 0,
    right: resolved.endsWith("right") ? inset : 0,
    bottom: resolved.startsWith("bottom") ? inset : 0,
    left: resolved.endsWith("left") ? inset : 0,
    position: resolved,
  };
}

function drawCoverImage(ctx: SKRSContext2D, image: Image, cx: number, cy: number, diameter: number): void {
  const scale = Math.max(diameter / image.width, diameter / image.height);
  const width = image.width * scale;
  const height = image.height * scale;
  ctx.drawImage(image, cx - width / 2, cy - height / 2, width, height);
}

export function drawPresenterOverlay(
  ctx: SKRSContext2D,
  opts: { dims: Dims; theme?: ResolvedBundleTheme },
  state: PresenterOverlayState,
): void {
  const theme = opts.theme ?? resolveBundleTheme();
  const colors = theme.colors;
  const base = Math.min(opts.dims.width, opts.dims.height);
  const diameter = base * PRESENTER.diameter[state.size];
  const radius = diameter / 2;
  const margin = base * PRESENTER.margin;
  const amplitude = clamp01(state.amplitude);
  const position = resolvePosition(state.position, opts.dims);
  const center = bubbleCenter(position, opts.dims, radius, margin);
  const border = rgba(colors.fg, theme.mode === "paper" ? 0.13 : 0.11);

  ctx.save();
  ctx.translate(center.x, center.y);

  if (amplitude > 0.01) {
    const haloRadius = radius * (PRESENTER.haloRest + amplitude * PRESENTER.haloAmplitude);
    const halo = ctx.createRadialGradient(0, 0, radius * 0.85, 0, 0, haloRadius);
    halo.addColorStop(0, rgba(colors.accent, 0.28 * amplitude));
    halo.addColorStop(1, rgba(colors.accent, 0));
    ctx.beginPath();
    ctx.arc(0, 0, haloRadius, 0, Math.PI * 2);
    ctx.fillStyle = halo;
    ctx.fill();
  }

  const ringRadius = radius * (PRESENTER.ringRest + amplitude * PRESENTER.ringAmplitude);
  ctx.beginPath();
  ctx.arc(0, 0, ringRadius, 0, Math.PI * 2);
  ctx.strokeStyle = rgba(colors.accent, 0.25 + 0.55 * amplitude);
  ctx.lineWidth = Math.max(2, radius * PRESENTER.ringWidth);
  ctx.stroke();

  ctx.save();
  ctx.shadowColor = "rgba(0, 0, 0, 0.35)";
  ctx.shadowBlur = radius * 0.3;
  ctx.shadowOffsetY = radius * 0.08;
  ctx.beginPath();
  ctx.arc(0, 0, radius, 0, Math.PI * 2);
  ctx.fillStyle = colors.surface;
  ctx.fill();
  ctx.restore();
  ctx.save();
  ctx.beginPath();
  ctx.arc(0, 0, radius, 0, Math.PI * 2);
  ctx.clip();
  drawCoverImage(ctx, state.avatar, 0, 0, diameter);
  ctx.restore();
  ctx.beginPath();
  ctx.arc(0, 0, radius, 0, Math.PI * 2);
  ctx.strokeStyle = border;
  ctx.lineWidth = 1.5;
  ctx.stroke();

  if (state.logo || state.monogram) {
    const badgeRadius = (diameter * PRESENTER.badgeScale) / 2;
    const offset = radius * PRESENTER.badgeOffset;
    ctx.save();
    ctx.shadowColor = "rgba(0, 0, 0, 0.3)";
    ctx.shadowBlur = badgeRadius * 0.4;
    ctx.beginPath();
    ctx.arc(offset, offset, badgeRadius, 0, Math.PI * 2);
    ctx.fillStyle = colors.surface;
    ctx.fill();
    ctx.restore();
    if (state.logo) {
      ctx.save();
      ctx.beginPath();
      ctx.arc(offset, offset, badgeRadius - 1, 0, Math.PI * 2);
      ctx.clip();
      drawCoverImage(ctx, state.logo, offset, offset, badgeRadius * 2);
      ctx.restore();
    } else if (state.monogram) {
      ctx.font = `${Math.round(badgeRadius * 1.1)}px '${theme.typography.display}', 'Inter Bold Greek', 'Noto Sans Math'`;
      ctx.textAlign = "center";
      ctx.textBaseline = "middle";
      ctx.fillStyle = colors.accent;
      ctx.fillText(state.monogram, offset, offset + badgeRadius * 0.06);
    }
    ctx.beginPath();
    ctx.arc(offset, offset, badgeRadius, 0, Math.PI * 2);
    ctx.strokeStyle = border;
    ctx.lineWidth = 1.5;
    ctx.stroke();
  }

  ctx.restore();
}

/**
 * Render the presenter bubble as a full-frame transparent PNG. Screencap clips
 * overlay this held state (no per-frame loudness pulse) so the bubble stays
 * present through timed media instead of vanishing between web scenes.
 */
export function renderPresenterPng(
  aspectRatio: AspectRatio,
  theme: ResolvedBundleTheme | undefined,
  state: PresenterOverlayState,
): Buffer {
  ensureFonts();
  const dims = dimsFor(aspectRatio);
  const canvas = createCanvas(dims.width, dims.height);
  drawPresenterOverlay(canvas.getContext("2d"), { dims, theme }, state);
  return canvas.toBuffer("image/png");
}
