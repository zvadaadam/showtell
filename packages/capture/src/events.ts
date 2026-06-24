/**
 * The event bridge: turn an agent's browser/app actions (Claude-in-Chrome or
 * agent-browser — click/type/scroll/navigate at a point) into camera events,
 * and persist them next to the recording so the camera can be recomputed
 * deterministically at render time.
 *
 * A driver records the screen and, for each action it takes, appends an event:
 *   recordScreen(...) ; on each browser action → recordCaptureEvent(id, action)
 * Then the screencap scene auto-directs from `<id>.events.json`.
 */
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { sessionPath, assertValidSessionId, ensureCapturesDir } from "./sessions.ts";
import type { CaptureEvent, CaptureEventType } from "./camera.ts";

const KINDS: readonly CaptureEventType[] = ["click", "type", "scroll", "navigate", "idle"];

/** A raw browser/app action (the shape Claude-in-Chrome / agent-browser emit). */
export interface BrowserAction {
  type: string;
  x?: number;
  y?: number;
  /** ms since recording start; the driver supplies it. */
  t: number;
}

/** Normalize a browser action into a camera event (unknown types → "idle"). */
export function toCaptureEvent(a: BrowserAction, source: { width: number; height: number }): CaptureEvent {
  const type = (KINDS as readonly string[]).includes(a.type) ? (a.type as CaptureEventType) : "idle";
  return {
    t: Math.max(0, a.t),
    type,
    x: clamp(a.x ?? source.width / 2, 0, source.width),
    y: clamp(a.y ?? source.height / 2, 0, source.height),
  };
}

function clamp(v: number, lo: number, hi: number): number {
  return Math.min(hi, Math.max(lo, v));
}

function eventsPath(id: string, root: string): string {
  assertValidSessionId(id);
  return sessionPath(id, root).replace(/\.mp4$/, ".events.json");
}

/** Append one event to a session's sidecar (creates it if needed). */
export function recordCaptureEvent(id: string, root: string, event: CaptureEvent): void {
  ensureCapturesDir(root);
  const events = loadSessionEvents(id, root) ?? [];
  events.push(event);
  writeFileSync(eventsPath(id, root), JSON.stringify(events));
}

/** Load a session's recorded events, or null if it has none (→ flat capture). */
export function loadSessionEvents(id: string, root: string): CaptureEvent[] | null {
  const p = eventsPath(id, root);
  if (!existsSync(p)) return null;
  try {
    const data = JSON.parse(readFileSync(p, "utf-8"));
    return Array.isArray(data) ? (data as CaptureEvent[]) : null;
  } catch {
    return null;
  }
}
