/**
 * The auto-zoom camera engine (ported from @deus/screen-studio, MIT).
 *
 * Given the agent's own actions while it drove an app/browser — clicks, typing,
 * scrolls, navigations at (x,y) — it computes a smooth spring-physics camera
 * path (zoom + pan) over the recording. The camera follows what the agent did,
 * so a `screencap` is auto-directed instead of a flat grab. The browser tool's
 * actions ARE the camera events (see `events.ts`).
 *
 * Pure + deterministic: the timeline is a function of (events, opts) only — no
 * wall-clock, no RNG — so `same input → same camera path → same mp4`.
 */

export type CaptureEventType = "click" | "type" | "scroll" | "navigate" | "idle";

/** One agent action during the recording (ms timestamp + source-pixel point). */
export interface CaptureEvent {
  /** Best cue timestamp for camera/effects, in ms since recording start. */
  t: number;
  type: CaptureEventType;
  x: number;
  y: number;
  /** Optional uncertainty window for wrapped commands that only know start/end. */
  startT?: number;
  endT?: number;
}

/** A sampled camera transform: viewport center (source px) + zoom multiplier. */
export interface CameraKeyframe {
  t: number;
  x: number;
  y: number;
  zoom: number;
}

export interface CameraOpts {
  durationSec: number;
  fps: number;
  source: { width: number; height: number };
  /** Critically damped by default (no overshoot). */
  omega?: number;
  zeta?: number;
}

/** Zoom level each action type pulls the camera toward. */
const ZOOM_FOR: Record<CaptureEventType, number> = {
  click: 1.8,
  type: 2.0,
  scroll: 1.3,
  navigate: 1.0,
  idle: 1.0,
};

interface Target {
  x: number;
  y: number;
  zoom: number;
}

/** Critically/under-damped spring integration step (semi-implicit Euler). */
function spring(cur: number, vel: number, target: number, dt: number, omega: number, zeta: number): [number, number] {
  const accel = omega * omega * (target - cur) - 2 * zeta * omega * vel;
  const nextVel = vel + accel * dt;
  return [cur + nextVel * dt, nextVel];
}

/** The active target at time `t` (the most recent event; centered before any). */
function targetAt(events: CaptureEvent[], t: number, source: { width: number; height: number }): Target {
  const cx = source.width / 2;
  const cy = source.height / 2;
  let target: Target = { x: cx, y: cy, zoom: 1.0 };
  for (const e of events) {
    if (e.t > t) break;
    const zoom = ZOOM_FOR[e.type];
    // For zoomed-in actions, frame the point; for full-frame ones, recenter.
    target = zoom > 1.0 ? { x: e.x, y: e.y, zoom } : { x: cx, y: cy, zoom };
  }
  return target;
}

/** Clamp the viewport center so the zoomed crop stays inside the source frame. */
function clampCenter(x: number, y: number, zoom: number, source: { width: number; height: number }): [number, number] {
  const halfW = source.width / (2 * zoom);
  const halfH = source.height / (2 * zoom);
  return [Math.min(source.width - halfW, Math.max(halfW, x)), Math.min(source.height - halfH, Math.max(halfH, y))];
}

/**
 * Compute the camera timeline: one keyframe per frame, the spring chasing the
 * active event target. Sorted, idle-decaying, bounds-clamped.
 */
export function computeCameraTimeline(events: CaptureEvent[], opts: CameraOpts): CameraKeyframe[] {
  const omega = opts.omega ?? 8;
  const zeta = opts.zeta ?? 1.0;
  const dt = 1 / opts.fps;
  const frames = Math.max(1, Math.round(opts.durationSec * opts.fps));
  const sorted = [...events].sort((a, b) => a.t - b.t);

  let x = opts.source.width / 2;
  let y = opts.source.height / 2;
  let zoom = 1.0;
  let vx = 0;
  let vy = 0;
  let vz = 0;

  const out: CameraKeyframe[] = [];
  for (let i = 0; i < frames; i++) {
    const tMs = i * dt * 1000;
    const tgt = targetAt(sorted, tMs, opts.source);
    [x, vx] = spring(x, vx, tgt.x, dt, omega, zeta);
    [y, vy] = spring(y, vy, tgt.y, dt, omega, zeta);
    [zoom, vz] = spring(zoom, vz, tgt.zoom, dt, omega, zeta);
    const z = Math.max(1.0, zoom);
    const [cx, cy] = clampCenter(x, y, z, opts.source);
    out.push({ t: tMs, x: cx, y: cy, zoom: z });
  }
  return out;
}
