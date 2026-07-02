import type { BundleScene, BundleTimeSpanValue } from "@agent-video/core";
import { parseBundleTimePointRef, parseBundleTimeSpanRef } from "@agent-video/core";
import type { CompiledBundleScene, CompiledBundleSpan } from "./bundle.ts";

interface BundleTimeResolveState {
  ranges: Set<string>;
  anchors: Set<string>;
}

function initialState(state?: BundleTimeResolveState): BundleTimeResolveState {
  return state ?? { ranges: new Set(), anchors: new Set() };
}

export function resolveBundlePoint(
  ref: string,
  currentScene: string,
  scenes: CompiledBundleScene[],
  sceneSpecs: BundleScene[],
  totalMs: number,
  state?: BundleTimeResolveState,
): number {
  state = initialState(state);
  const parsed = parseBundleTimePointRef(ref);
  if (!parsed) throw new Error(`Unsupported point time ref "${ref}".`);

  const sceneById = new Map(scenes.map((scene) => [scene.id, scene]));
  const specById = new Map(sceneSpecs.map((scene) => [scene.id, scene]));

  if (parsed.kind === "video") return parsed.pos === "start" ? 0 : totalMs;
  if (parsed.kind === "scene") {
    const scene = sceneById.get(parsed.sceneId);
    if (!scene) throw new Error(`Unknown scene time ref "${ref}".`);
    return parsed.pos === "start" ? scene.startMs : scene.endMs;
  }

  if (parsed.kind === "beat") {
    const sceneId = parsed.sceneId ?? currentScene;
    const beat = sceneById.get(sceneId)?.beats[parsed.id];
    if (!beat) throw new Error(`Unknown beat time ref "${ref}".`);
    if (parsed.pos === "start") return beat.startMs;
    if (parsed.pos === "end") return beat.endMs;
    return Math.round(beat.startMs + beat.durationMs * parsed.pos);
  }

  if (parsed.kind === "line") {
    const sceneId = parsed.sceneId ?? currentScene;
    const line = sceneById.get(sceneId)?.narration.lines.find((item) => item.id === parsed.id);
    if (!line) throw new Error(`Unknown line time ref "${ref}".`);
    return parsed.pos === "start" ? line.startMs : line.endMs;
  }

  if (parsed.kind === "range") {
    const sceneId = parsed.sceneId ?? currentScene;
    const range = resolveBundleRange(sceneId, parsed.id, scenes, sceneSpecs, totalMs, state, ref);
    return parsed.pos === "start" ? range.startMs : range.endMs;
  }

  const scene = sceneById.get(parsed.sceneId);
  const spec = specById.get(parsed.sceneId);
  const anchor = spec?.anchors.find((item) => item.id === parsed.id);
  if (!scene || !anchor) throw new Error(`Unknown anchor time ref "${ref}".`);
  const key = `${scene.id}/${anchor.id}`;
  if (state.anchors.has(key)) throw new Error(`Anchor cycle at "${key}".`);
  state.anchors.add(key);
  try {
    return resolveBundlePoint(anchor.at, scene.id, scenes, sceneSpecs, totalMs, state);
  } finally {
    state.anchors.delete(key);
  }
}

export function resolveBundleSpan(
  ref: BundleTimeSpanValue,
  currentScene: string,
  scenes: CompiledBundleScene[],
  sceneSpecs: BundleScene[],
  totalMs: number,
  state?: BundleTimeResolveState,
): CompiledBundleSpan {
  state = initialState(state);
  if (typeof ref !== "string") {
    const startMs = resolveBundlePoint(ref.from, currentScene, scenes, sceneSpecs, totalMs, state);
    const endMs = resolveBundlePoint(ref.to, currentScene, scenes, sceneSpecs, totalMs, state);
    if (endMs <= startMs) throw new Error(`Range "${ref.from}".."${ref.to}" does not move forward.`);
    return { startMs, endMs, durationMs: endMs - startMs };
  }

  const parsed = parseBundleTimeSpanRef(ref);
  if (!parsed) throw new Error(`Unsupported span time ref "${ref}".`);
  if (parsed.kind === "video") return { startMs: 0, endMs: totalMs, durationMs: totalMs };

  const sceneById = new Map(scenes.map((scene) => [scene.id, scene]));
  if (parsed.kind === "scene") {
    const scene = sceneById.get(parsed.sceneId);
    if (!scene) throw new Error(`Unknown scene span ref "${ref}".`);
    return { startMs: scene.startMs, endMs: scene.endMs, durationMs: scene.durationMs };
  }

  const sceneId = parsed.sceneId ?? currentScene;
  if (parsed.kind === "beat") {
    const beat = sceneById.get(sceneId)?.beats[parsed.id];
    if (!beat) throw new Error(`Unknown beat span ref "${ref}".`);
    return { startMs: beat.startMs, endMs: beat.endMs, durationMs: beat.durationMs };
  }
  if (parsed.kind === "line") {
    const line = sceneById.get(sceneId)?.narration.lines.find((item) => item.id === parsed.id);
    if (!line) throw new Error(`Unknown line span ref "${ref}".`);
    return { startMs: line.startMs, endMs: line.endMs, durationMs: line.durationMs };
  }
  return resolveBundleRange(sceneId, parsed.id, scenes, sceneSpecs, totalMs, state, ref);
}

export function resolveBundleRange(
  sceneId: string,
  rangeId: string,
  scenes: CompiledBundleScene[],
  sceneSpecs: BundleScene[],
  totalMs: number,
  state?: BundleTimeResolveState,
  authorRef?: string,
): CompiledBundleSpan {
  state = initialState(state);
  const compiled = scenes.find((scene) => scene.id === sceneId);
  if (!compiled) throw new Error(`Unknown scene "${sceneId}" for range "${rangeId}".`);
  const cached = compiled.ranges[rangeId];
  if (cached) return cached;
  const key = `${sceneId}/${rangeId}`;
  if (state.ranges.has(key)) throw new Error(`Range cycle at "${key}".`);
  const spec = sceneSpecs.find((scene) => scene.id === sceneId);
  const def = spec?.ranges[rangeId];
  if (!def) {
    const source = authorRef ? ` (from ref "${authorRef}")` : "";
    throw new Error(`Unknown range "${key}"${source}.`);
  }
  state.ranges.add(key);
  try {
    const resolved = resolveBundleSpan(def, sceneId, scenes, sceneSpecs, totalMs, state);
    compiled.ranges[rangeId] = resolved;
    return resolved;
  } finally {
    state.ranges.delete(key);
  }
}
