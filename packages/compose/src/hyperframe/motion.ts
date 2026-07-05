/**
 * Deterministic motion for hyperframe rendering.
 *
 * Every animation is a pure function of the compiled timeline (milliseconds
 * from the plan), so the same spec still renders the same pixels. When no
 * motion clock is present (workshop stills, thumbnails), every helper returns
 * its END state — stills always show the finished composition, never a
 * half-entered frame.
 */
import { TOKENS } from "./tokens.ts";
import type { RenderEnv } from "./tokens.ts";

/** Wall-clock positions inside the compiled timeline for the frame being drawn. */
export interface MotionClock {
  /** ms since the start of the whole video. */
  absoluteMs: number;
  /** ms since the start of the current scene. */
  sceneMs: number;
  /** ms since the start of the active narration line. */
  lineMs: number;
  fps: number;
}

export function clamp01(value: number): number {
  return Math.max(0, Math.min(1, value));
}

export function easeOutCubic(t: number): number {
  const clamped = clamp01(t);
  return 1 - (1 - clamped) ** 3;
}

export function easeOutExpo(t: number): number {
  const clamped = clamp01(t);
  return clamped >= 1 ? 1 : 1 - 2 ** (-10 * clamped);
}

/** Slight overshoot for playful pops (check circles, chips). */
export function easeOutBack(t: number): number {
  const clamped = clamp01(t);
  const c1 = 1.30158;
  const c3 = c1 + 1;
  return 1 + c3 * (clamped - 1) ** 3 + c1 * (clamped - 1) ** 2;
}

/**
 * Scene-entrance progress in [0,1]: 0 before `delayMs` into the scene, 1 once
 * `durationMs` has elapsed. Returns 1 when there is no motion clock.
 */
export function enter01(env: RenderEnv, delayMs: number, durationMs: number): number {
  if (!env.motion) return 1;
  if (durationMs <= 0) return 1;
  return clamp01((env.motion.sceneMs - delayMs) / durationMs);
}

/** Like enter01 but keyed on the active narration line instead of the scene. */
export function lineEnter01(env: RenderEnv, delayMs: number, durationMs: number): number {
  if (!env.motion) return 1;
  if (durationMs <= 0) return 1;
  return clamp01((env.motion.lineMs - delayMs) / durationMs);
}

/** Gentle 0→1→0 breathing wave for live-state pulses. 0 when there is no clock. */
export function pulse01(env: RenderEnv, periodMs: number = TOKENS.motion.pulseMs): number {
  if (!env.motion || periodMs <= 0) return 0;
  return 0.5 - 0.5 * Math.cos((env.motion.absoluteMs / periodMs) * Math.PI * 2);
}

/** Slow sinusoidal drift in [-1,1] for background life. 0 when there is no clock. */
export function drift(env: RenderEnv, periodMs: number = TOKENS.motion.driftMs, phase = 0): number {
  if (!env.motion || periodMs <= 0) return 0;
  return Math.sin((env.motion.absoluteMs / periodMs + phase) * Math.PI * 2);
}

/**
 * Animate the numeric part of a display value ("183", "17.6:1", "4.9×",
 * "-120ms") while keeping prefix/suffix intact. Decimal places are preserved
 * so the count-up never jitters in width more than the final value does.
 */
export function countUpValue(value: string, t: number): string {
  if (t >= 1) return value;
  const match = /^([^0-9]*)(\d+(?:\.\d+)?)(.*)$/.exec(value);
  if (!match) return value;
  const [, prefix, digits, suffix] = match as unknown as [string, string, string, string];
  const decimals = digits.includes(".") ? digits.split(".")[1]!.length : 0;
  const target = Number.parseFloat(digits);
  return `${prefix}${(target * clamp01(t)).toFixed(decimals)}${suffix}`;
}
