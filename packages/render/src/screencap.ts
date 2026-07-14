import type { VideoSpec } from "@showtell/core";
import { probeDurationMs, probeVideoSize } from "@showtell/providers";
import {
  alignEventsToVisualActivity,
  analyzeVisualActivity,
  compositeScreencap,
  computeCameraTimeline,
  createActionPlaybackPlan,
  createSmartPlaybackPlan,
  loadSessionEvents,
  remapEventsToPlayback,
  resolveSession,
  type ActionPlaybackConfig,
  type ScreencapOverlay,
  type CameraKeyframe,
  type CaptureEvent,
  type PlaybackPlan,
  type VisualActivityConfig,
} from "@showtell/capture";

type SimpleScreencapScene = Extract<VideoSpec["scenes"][number], { kind: "screencap" }>;
export type ScreencapSource = Pick<SimpleScreencapScene["content"], "sessionRef" | "clip" | "playback">;
type ScreencapPlayback = NonNullable<ScreencapSource["playback"]>;
type ScreencapCompositeOptions = Parameters<typeof compositeScreencap>[0];
type CameraMode = "auto" | "follow" | "none";
type ResolvedCameraMode = Exclude<CameraMode, "auto">;
type ActionEffectMode = "auto" | "tap-glow" | "none";
type ResolvedActionEffectMode = Exclude<ActionEffectMode, "auto">;

export interface ScreencapPresentation {
  source: string;
  sourceStartSec: number;
  sourceDurationSec?: number;
  sourceSize?: { width: number; height: number };
  playbackPlan?: PlaybackPlan;
  camera?: CameraKeyframe[];
  actionEffects?: CaptureEvent[];
  warnings: string[];
}

export type ScreencapPresentationCache = Map<number, ScreencapPresentation>;

export interface ScreencapClipRequest {
  sceneIndex: number;
  capture: ScreencapSource;
  repoPath: string;
  outPath: string;
  width: number;
  height: number;
  durationSec: number;
  fps: number;
  audio?: string;
  overlays?: ScreencapOverlay[];
}

/**
 * Prepare once per scene, then composite once per requested aspect ratio.
 * Warnings are returned only on the preparation call so a multi-aspect render
 * reports each scheduling fallback once, matching the scene-level semantics.
 */
export function renderScreencapClip(
  presentations: ScreencapPresentationCache,
  request: ScreencapClipRequest,
): string[] {
  let presentation = presentations.get(request.sceneIndex);
  let warnings: string[] = [];
  if (!presentation) {
    presentation = prepareScreencapPresentation(request.capture, {
      repoPath: request.repoPath,
      durationSec: request.durationSec,
      fps: request.fps,
    });
    presentations.set(request.sceneIndex, presentation);
    warnings = [...presentation.warnings];
  }

  compositeScreencap(buildScreencapCompositeOptions(presentation, request));
  return warnings;
}

/** Exact capture/mux handoff shared by every screencap rendering pipeline. */
export function buildScreencapCompositeOptions(
  presentation: ScreencapPresentation,
  request: Omit<ScreencapClipRequest, "sceneIndex" | "capture" | "repoPath">,
): ScreencapCompositeOptions {
  return {
    source: presentation.source,
    sourceStartSec: presentation.sourceStartSec,
    sourceDurationSec: presentation.sourceDurationSec,
    outPath: request.outPath,
    width: request.width,
    height: request.height,
    durationSec: request.durationSec,
    fps: request.fps,
    audio: request.audio,
    overlays: request.overlays,
    camera: presentation.camera,
    sourceSize: presentation.sourceSize,
    playbackPlan: presentation.playbackPlan,
    actionEffects: presentation.actionEffects,
  };
}

export function prepareScreencapPresentation(
  capture: ScreencapSource,
  opts: { repoPath: string; durationSec: number; fps: number },
): ScreencapPresentation {
  const ref = capture.sessionRef;
  const source = resolveSession(ref, opts.repoPath);
  const clipRange = capture.clip;
  const sourceStartSec = clipRange?.start ?? 0;
  const sourceDurationSec = clipRange ? clipRange.end - clipRange.start : undefined;
  const sourceDurationMs = measureSourceDurationMs(source, sourceStartSec, sourceDurationSec);
  const playback = capture.playback;
  const warnings: string[] = [];

  let events = eventsForClip(loadSessionEvents(ref, opts.repoPath), clipRange);
  let sourceSize: { width: number; height: number } | undefined;
  let playbackPlan: PlaybackPlan | undefined;

  if (playback?.mode === "action-only") {
    const eventPlan =
      events && events.length > 0
        ? createActionPlaybackPlan(events, sourceDurationMs, playbackConfig(playback), opts.durationSec * 1000)
        : null;
    if (eventPlan) {
      playbackPlan = eventPlan;
      events = remapEventsToPlayback(events!, playbackPlan);
    } else {
      warnings.push(actionOnlyWarning(events));
    }
  } else if (playback?.mode === "smart") {
    sourceSize = probeVideoSize(source);
    const activity = analyzeVisualActivity({
      source,
      sourceStartSec,
      sourceDurationSec,
      sourceSize,
      config: visualActivityConfig(playback),
    });
    const alignedEvents = events ? alignEventsToVisualActivity(events, activity.intervals) : events;
    playbackPlan =
      createSmartPlaybackPlan({
        events: alignedEvents,
        visualWindows: activity.intervals,
        sourceDurationMs,
        config: playbackConfig(playback),
        fitToDurationMs: opts.durationSec * 1000,
      }) ?? undefined;

    if (playbackPlan) {
      const cameraEvents = alignedEvents && alignedEvents.length > 0 ? alignedEvents : activity.events;
      events = remapEventsToPlayback(cameraEvents, playbackPlan);
    } else {
      warnings.push("screencap playback.mode=smart found no event sidecar and no visual activity; rendering realtime.");
    }
  }

  let camera: CameraKeyframe[] | undefined;
  let actionEffects: CaptureEvent[] | undefined;
  if (events && events.length > 0) {
    sourceSize ??= probeVideoSize(source);
    const cameraMode = resolveCameraMode(playback, sourceSize);
    const effectMode = resolveActionEffects(playback, sourceSize, cameraMode);
    if (cameraMode === "follow") {
      camera = computeCameraTimeline(events, { durationSec: opts.durationSec, fps: opts.fps, source: sourceSize });
    }
    if (effectMode === "tap-glow") actionEffects = events;
  }

  return {
    source,
    sourceStartSec,
    sourceDurationSec,
    sourceSize,
    playbackPlan,
    camera,
    actionEffects,
    warnings,
  };
}

function measureSourceDurationMs(source: string, startSec: number, durationSec: number | undefined): number {
  if (durationSec !== undefined) return durationSec * 1000;
  return Math.max(0, probeDurationMs(source) - startSec * 1000);
}

function eventsForClip(events: CaptureEvent[] | null, clipRange: ScreencapSource["clip"]): CaptureEvent[] | null {
  if (!events || !clipRange) return events;
  const startMs = clipRange.start * 1000;
  const endMs = clipRange.end * 1000;
  const durationMs = endMs - startMs;
  return events
    .filter((event) => eventOverlapsRange(event, startMs, endMs))
    .map((event) => ({
      ...event,
      t: clamp(event.t - startMs, 0, durationMs),
      ...(event.startT === undefined ? {} : { startT: clamp(event.startT - startMs, 0, durationMs) }),
      ...(event.endT === undefined ? {} : { endT: clamp(event.endT - startMs, 0, durationMs) }),
    }));
}

function eventOverlapsRange(event: CaptureEvent, startMs: number, endMs: number): boolean {
  const eventStart = Math.min(event.startT ?? event.t, event.endT ?? event.t);
  const eventEnd = Math.max(event.startT ?? event.t, event.endT ?? event.t);
  return eventEnd >= startMs && eventStart <= endMs;
}

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}

function actionOnlyWarning(events: CaptureEvent[] | null): string {
  return events && events.length > 0
    ? "screencap playback.mode=action-only had no click/type/scroll/navigate events; rendering realtime."
    : "screencap playback.mode=action-only needs a .events.json sidecar; rendering realtime.";
}

function playbackConfig(playback: ScreencapPlayback): Partial<ActionPlaybackConfig> {
  return {
    preActionPaddingMs: playback.preActionPaddingMs,
    postActionPaddingMs: playback.postActionPaddingMs,
    targetGapOutputMs: playback.targetGapOutputMs,
    maxGapOutputMs: playback.maxGapOutputMs,
    maxPlaybackRate: playback.maxPlaybackRate,
    minGapToSpeedUpMs: playback.minGapToSpeedUpMs,
  };
}

function visualActivityConfig(playback: ScreencapPlayback): Partial<VisualActivityConfig> {
  return {
    sampleFps: playback.visualSampleFps,
    minScore: playback.visualMinScore,
  };
}

function isPortraitSource(sourceSize: { width: number; height: number }): boolean {
  return sourceSize.height > sourceSize.width;
}

function resolveCameraMode(
  playback: { camera?: CameraMode } | undefined,
  sourceSize: { width: number; height: number },
): ResolvedCameraMode {
  const requested = playback?.camera ?? "auto";
  if (requested !== "auto") return requested;
  return isPortraitSource(sourceSize) ? "none" : "follow";
}

function resolveActionEffects(
  playback: { actionEffects?: ActionEffectMode } | undefined,
  sourceSize: { width: number; height: number },
  cameraMode: ResolvedCameraMode,
): ResolvedActionEffectMode {
  const requested = playback?.actionEffects ?? "auto";
  if (requested !== "auto") return requested;
  return cameraMode === "none" || isPortraitSource(sourceSize) ? "tap-glow" : "none";
}
