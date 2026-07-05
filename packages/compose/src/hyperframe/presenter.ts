/**
 * Presenter bubble: renderer-owned chrome (like the watermark and captions)
 * drawn on top of every frame — the user's avatar in a circle, a circular
 * model badge on its lower-right edge, and an accent ring + halo that pulse
 * with the narration's measured amplitude. At amplitude 0 (stills, scene
 * tails) the bubble is at rest, so workshop frames and thumbnails stay honest.
 */
import { readFileSync } from "node:fs";
import { createCanvas, loadImage, type Image, type SKRSContext2D } from "@napi-rs/canvas";
import type { AspectRatio } from "@agent-video/core";
import type { HyperframeTheme } from "@agent-video/hyperframes";
import { dimsFor, type Dims } from "../dims.ts";
import { ensureFonts } from "../fonts.ts";
import { resolveAgentLogo } from "./agent-logos.ts";
import { clamp01, easeOutBack } from "./motion.ts";
import { fontFor } from "./typography.ts";
import { paletteFor, rgba, TOKENS, type RenderEnv } from "./tokens.ts";

export type PresenterPosition = "auto" | "top-left" | "top-center" | "top-right" | "bottom-left" | "bottom-right";
export type PresenterSize = "sm" | "md" | "lg";

/** Loaded once per render run; amplitude is added per frame. */
export interface LoadedPresenter {
  avatar: Image;
  logo?: Image;
  /** Badge letter fallback when no logo image is declared. */
  monogram?: string;
  position: PresenterPosition;
  size: PresenterSize;
}

export interface PresenterOverlayState extends LoadedPresenter {
  /** Narration loudness 0..1 for this frame; 0 = at rest. */
  amplitude: number;
}

export async function loadPresenterOverlay(opts: {
  imagePath: string;
  /** Bundle-local logo file; wins over the built-in mark resolved from `model`. */
  logoPath?: string;
  model?: string;
  position: PresenterPosition;
  size: PresenterSize;
}): Promise<LoadedPresenter> {
  const logoPath = opts.logoPath ?? resolveAgentLogo(opts.model)?.path;
  return {
    avatar: await loadImage(opts.imagePath),
    // Bytes, not path: built-in marks live in bun's embedded FS inside the
    // compiled binary, which node:fs can read but the native loader cannot.
    logo: logoPath ? await loadImage(readFileSync(logoPath)) : undefined,
    monogram: opts.model?.trim() ? opts.model.trim()[0]!.toUpperCase() : undefined,
    position: opts.position,
    size: opts.size,
  };
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

function drawCoverImage(ctx: SKRSContext2D, image: Image, cx: number, cy: number, diameter: number): void {
  const scale = Math.max(diameter / image.width, diameter / image.height);
  const w = image.width * scale;
  const h = image.height * scale;
  ctx.drawImage(image, cx - w / 2, cy - h / 2, w, h);
}

/** Draw the presenter bubble for one frame. Call after the scene tree. */
export function drawPresenterOverlay(ctx: SKRSContext2D, env: RenderEnv, state: PresenterOverlayState): void {
  const t = TOKENS.presenter;
  const base = Math.min(env.dims.width, env.dims.height);
  const diameter = base * t.diameter[state.size];
  const radius = diameter / 2;
  const margin = base * t.margin;
  const amplitude = clamp01(state.amplitude);
  const position = resolvePosition(state.position, env.dims);
  const center = bubbleCenter(position, env.dims, radius, margin);

  // Entrance pop at the very start of the video; stills render the end state.
  const enter = env.motion ? easeOutBack(clamp01(env.motion.absoluteMs / t.enterMs)) : 1;
  if (enter <= 0) return;

  ctx.save();
  ctx.translate(center.x, center.y);
  ctx.scale(enter, enter);
  ctx.globalAlpha = clamp01(enter * 1.4);

  // Amplitude halo: a soft accent glow that swells with speech loudness.
  if (amplitude > 0.01) {
    const haloRadius = radius * (t.haloRest + amplitude * t.haloAmplitude);
    const halo = ctx.createRadialGradient(0, 0, radius * 0.85, 0, 0, haloRadius);
    halo.addColorStop(0, rgba(env.palette.accent, 0.28 * amplitude));
    halo.addColorStop(1, rgba(env.palette.accent, 0));
    ctx.beginPath();
    ctx.arc(0, 0, haloRadius, 0, Math.PI * 2);
    ctx.fillStyle = halo;
    ctx.fill();
  }

  // Pulse ring: rides just outside the avatar, brightening and expanding with amplitude.
  const ringRadius = radius * (t.ringRest + amplitude * t.ringAmplitude);
  ctx.beginPath();
  ctx.arc(0, 0, ringRadius, 0, Math.PI * 2);
  ctx.strokeStyle = rgba(env.palette.accent, 0.25 + 0.55 * amplitude);
  ctx.lineWidth = Math.max(2, radius * t.ringWidth);
  ctx.stroke();

  // Avatar disc: surface backing (covers transparency), soft shadow, clipped image, hairline border.
  ctx.save();
  ctx.shadowColor = "rgba(0, 0, 0, 0.35)";
  ctx.shadowBlur = radius * 0.3;
  ctx.shadowOffsetY = radius * 0.08;
  ctx.beginPath();
  ctx.arc(0, 0, radius, 0, Math.PI * 2);
  ctx.fillStyle = env.palette.surface;
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
  ctx.strokeStyle = env.palette.border;
  ctx.lineWidth = 1.5;
  ctx.stroke();

  // Model badge: a circular chip overlapping the avatar's lower-right edge.
  if (state.logo || state.monogram) {
    const badgeRadius = (diameter * t.badgeScale) / 2;
    const offset = radius * t.badgeOffset;
    const bx = offset;
    const by = offset;
    ctx.save();
    ctx.shadowColor = "rgba(0, 0, 0, 0.3)";
    ctx.shadowBlur = badgeRadius * 0.4;
    ctx.beginPath();
    ctx.arc(bx, by, badgeRadius, 0, Math.PI * 2);
    ctx.fillStyle = env.palette.surface;
    ctx.fill();
    ctx.restore();
    if (state.logo) {
      // Full-bleed: agent logo tiles (e.g. skills.sh marks) carry their own padding.
      ctx.save();
      ctx.beginPath();
      ctx.arc(bx, by, badgeRadius - 1, 0, Math.PI * 2);
      ctx.clip();
      drawCoverImage(ctx, state.logo, bx, by, badgeRadius * 2);
      ctx.restore();
    } else if (state.monogram) {
      ctx.font = fontFor(env, "display", Math.round(badgeRadius * 1.1));
      ctx.textAlign = "center";
      ctx.textBaseline = "middle";
      ctx.fillStyle = env.palette.accent;
      ctx.fillText(state.monogram, bx, by + badgeRadius * 0.06);
    }
    ctx.beginPath();
    ctx.arc(bx, by, badgeRadius, 0, Math.PI * 2);
    ctx.strokeStyle = env.palette.border;
    ctx.lineWidth = 1.5;
    ctx.stroke();
  }

  ctx.restore();
}

/** Composite the at-rest presenter bubble onto an already-rendered still. */
export async function renderPresenterFrame(
  basePng: Buffer,
  aspectRatio: AspectRatio,
  state: PresenterOverlayState,
  theme?: HyperframeTheme,
): Promise<Buffer> {
  ensureFonts();
  const dims = dimsFor(aspectRatio);
  const canvas = createCanvas(dims.width, dims.height);
  const ctx = canvas.getContext("2d");
  ctx.drawImage(await loadImage(basePng), 0, 0, dims.width, dims.height);
  drawPresenterOverlay(ctx, { dims, palette: paletteFor("dark", theme), theme }, state);
  return canvas.toBuffer("image/png");
}
