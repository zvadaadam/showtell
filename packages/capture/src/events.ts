import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { sessionPath, assertValidSessionId, ensureCapturesDir } from "./sessions.ts";
import type { CaptureEvent, CaptureEventType } from "./camera.ts";

const KINDS: readonly CaptureEventType[] = ["click", "type", "scroll", "navigate", "idle"];

function eventsPath(id: string, root: string): string {
  assertValidSessionId(id);
  return sessionPath(id, root).replace(/\.mp4$/, ".events.json");
}

export function normalizeCaptureEvents(data: unknown): CaptureEvent[] {
  if (!Array.isArray(data)) throw new Error("Events JSON must be an array of { t, type, x, y } objects.");
  return data.map((raw, i) => normalizeCaptureEvent(raw, i));
}

function normalizeCaptureEvent(raw: unknown, index: number): CaptureEvent {
  if (!raw || typeof raw !== "object") throw new Error(`Event ${index} must be an object.`);
  const rec = raw as Record<string, unknown>;
  const type = rec.type;
  if (typeof type !== "string" || !(KINDS as readonly string[]).includes(type)) {
    throw new Error(`Event ${index} has invalid type. Use one of: ${KINDS.join(", ")}.`);
  }
  const t = Math.max(0, numberField(rec, "t", index));
  const x = numberField(rec, "x", index);
  const y = numberField(rec, "y", index);
  const startT = optionalNumberField(rec, "startT", index);
  const endT = optionalNumberField(rec, "endT", index);
  if (startT !== undefined || endT !== undefined) {
    const start = Math.max(0, startT ?? t);
    const end = Math.max(0, endT ?? t);
    if (end < start) throw new Error(`Event ${index} has endT before startT.`);
    if (t < start || t > end) throw new Error(`Event ${index} field "t" must be inside startT/endT.`);
    return { t, type: type as CaptureEventType, x, y, startT: start, endT: end };
  }
  return { t, type: type as CaptureEventType, x, y };
}

function numberField(rec: Record<string, unknown>, field: "t" | "x" | "y" | "startT" | "endT", index: number): number {
  const value = rec[field];
  if (typeof value !== "number" || !Number.isFinite(value)) {
    throw new Error(`Event ${index} field "${field}" must be a finite number.`);
  }
  return value;
}

function optionalNumberField(
  rec: Record<string, unknown>,
  field: "startT" | "endT",
  index: number,
): number | undefined {
  return rec[field] === undefined ? undefined : numberField(rec, field, index);
}

/** Append one event to a session's sidecar (creates it if needed). */
export function recordCaptureEvent(id: string, root: string, event: CaptureEvent): void {
  ensureCapturesDir(root);
  const p = eventsPath(id, root);
  const events = existsSync(p) ? readSessionEvents(p) : [];
  events.push(event);
  writeSessionEvents(id, root, events);
}

/** Replace a session's sidecar with normalized events. */
export function writeSessionEvents(id: string, root: string, events: CaptureEvent[]): void {
  ensureCapturesDir(root);
  writeFileSync(eventsPath(id, root), JSON.stringify(events, null, 2) + "\n");
}

/** Load a session's recorded events, or null if it has none (→ flat capture). */
export function loadSessionEvents(id: string, root: string): CaptureEvent[] | null {
  const p = eventsPath(id, root);
  if (!existsSync(p)) return null;
  return readSessionEvents(p);
}

function readSessionEvents(path: string): CaptureEvent[] {
  return normalizeCaptureEvents(JSON.parse(readFileSync(path, "utf-8")));
}
