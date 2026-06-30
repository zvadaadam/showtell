import type { CaptureEvent } from "./camera.ts";

export interface PlaybackSegment {
  type: "action" | "gap";
  sourceStartMs: number;
  sourceEndMs: number;
  sourceDurationMs: number;
  outputStartMs: number;
  outputEndMs: number;
  outputDurationMs: number;
  /** 1 = realtime, 4 = 4x fast-forward, 0.5 = half speed. */
  playbackRate: number;
}

export interface PlaybackPlan {
  segments: PlaybackSegment[];
  sourceDurationMs: number;
  outputDurationMs: number;
  /** Dead time before the first kept action window. */
  droppedBeforeMs: number;
  /** Dead time after the last kept action window. */
  droppedAfterMs: number;
  actionCount: number;
  fittedToDurationMs?: number;
}

export interface ActionPlaybackConfig {
  preActionPaddingMs: number;
  postActionPaddingMs: number;
  targetGapOutputMs: number;
  maxGapOutputMs: number;
  maxPlaybackRate: number;
  minGapToSpeedUpMs: number;
}

export const DEFAULT_ACTION_PLAYBACK_CONFIG: ActionPlaybackConfig = {
  preActionPaddingMs: 600,
  postActionPaddingMs: 400,
  targetGapOutputMs: 900,
  maxGapOutputMs: 1500,
  maxPlaybackRate: 8,
  minGapToSpeedUpMs: 700,
};

interface ActionWindow {
  start: number;
  end: number;
}

export interface ActivityWindow {
  startMs: number;
  endMs: number;
}

export function isMeaningfulCaptureEvent(event: CaptureEvent): boolean {
  return event.type === "click" || event.type === "type" || event.type === "scroll" || event.type === "navigate";
}

export function createActionPlaybackPlan(
  events: CaptureEvent[],
  sourceDurationMs: number,
  config?: Partial<ActionPlaybackConfig>,
  fitToDurationMs?: number,
): PlaybackPlan | null {
  const sourceMs = Math.max(0, sourceDurationMs);
  const cfg = { ...DEFAULT_ACTION_PLAYBACK_CONFIG, ...dropUndefined(config) };
  const actionTimes = events
    .filter(isMeaningfulCaptureEvent)
    .map((e) => clamp(e.t, 0, sourceMs))
    .filter((t) => t < sourceMs)
    .sort((a, b) => a - b);

  if (sourceMs <= 0 || actionTimes.length === 0) return null;

  const windows = mergeActionWindows(actionTimes, sourceMs, cfg);
  return createWindowPlaybackPlan(windows, sourceMs, cfg, fitToDurationMs, actionTimes.length);
}

export function createVisualPlaybackPlan(
  windows: ActivityWindow[],
  sourceDurationMs: number,
  config?: Partial<ActionPlaybackConfig>,
  fitToDurationMs?: number,
): PlaybackPlan | null {
  const sourceMs = Math.max(0, sourceDurationMs);
  const cfg = { ...DEFAULT_ACTION_PLAYBACK_CONFIG, ...dropUndefined(config) };
  const padded = windows.map((window) => ({
    start: Math.max(0, window.startMs - cfg.preActionPaddingMs),
    end: Math.min(sourceMs, window.endMs + cfg.postActionPaddingMs),
  }));
  return createWindowPlaybackPlan(padded, sourceMs, cfg, fitToDurationMs, windows.length);
}

export function createSmartPlaybackPlan(opts: {
  events?: CaptureEvent[] | null;
  visualWindows?: ActivityWindow[] | null;
  sourceDurationMs: number;
  config?: Partial<ActionPlaybackConfig>;
  fitToDurationMs?: number;
}): PlaybackPlan | null {
  const sourceMs = Math.max(0, opts.sourceDurationMs);
  const cfg = { ...DEFAULT_ACTION_PLAYBACK_CONFIG, ...dropUndefined(opts.config) };
  const eventTimes = (opts.events ?? [])
    .filter(isMeaningfulCaptureEvent)
    .map((e) => clamp(e.t, 0, sourceMs))
    .filter((t) => t < sourceMs)
    .sort((a, b) => a - b);
  const eventWindows = mergeActionWindows(eventTimes, sourceMs, cfg);
  const visualWindows = (opts.visualWindows ?? []).map((window) => ({
    start: Math.max(0, window.startMs - cfg.preActionPaddingMs),
    end: Math.min(sourceMs, window.endMs + cfg.postActionPaddingMs),
  }));

  return createWindowPlaybackPlan(
    [...eventWindows, ...visualWindows],
    sourceMs,
    cfg,
    opts.fitToDurationMs,
    eventTimes.length + visualWindows.length,
  );
}

export function createWindowPlaybackPlan(
  windows: ActionWindow[],
  sourceDurationMs: number,
  config?: Partial<ActionPlaybackConfig>,
  fitToDurationMs?: number,
  actionCount = windows.length,
): PlaybackPlan | null {
  const sourceMs = Math.max(0, sourceDurationMs);
  const cfg = { ...DEFAULT_ACTION_PLAYBACK_CONFIG, ...dropUndefined(config) };
  const normalizedWindows = normalizeWindows(windows, sourceMs);
  if (sourceMs <= 0 || normalizedWindows.length === 0) return null;

  const segments = buildSegments(normalizedWindows, cfg);
  if (segments.length === 0) return null;

  const outputDurationMs = segments[segments.length - 1]!.outputEndMs;
  let plan: PlaybackPlan = {
    segments,
    sourceDurationMs: sourceMs,
    outputDurationMs,
    droppedBeforeMs: normalizedWindows[0]!.start,
    droppedAfterMs: Math.max(0, sourceMs - normalizedWindows[normalizedWindows.length - 1]!.end),
    actionCount,
  };

  if (fitToDurationMs && fitToDurationMs > 0 && outputDurationMs > 0) {
    plan = fitPlaybackPlanToDuration(plan, fitToDurationMs);
  }

  return plan;
}

export function remapEventsToPlayback(events: CaptureEvent[], plan: PlaybackPlan): CaptureEvent[] {
  return events.flatMap((event) => {
    const t = sourceToOutputTime(event.t, plan.segments);
    if (t === null) return [];
    return [{ ...event, t, ...remappedEventWindow(event, plan.segments) }];
  });
}

function remappedEventWindow(event: CaptureEvent, segments: PlaybackSegment[]): Pick<CaptureEvent, "startT" | "endT"> {
  const startT = event.startT === undefined ? undefined : sourceToOutputTime(event.startT, segments);
  const endT = event.endT === undefined ? undefined : sourceToOutputTime(event.endT, segments);
  return {
    ...(startT === null || startT === undefined ? {} : { startT }),
    ...(endT === null || endT === undefined ? {} : { endT }),
  };
}

export function sourceToOutputTime(sourceTimeMs: number, segments: PlaybackSegment[]): number | null {
  for (const seg of segments) {
    if (sourceTimeMs >= seg.sourceStartMs && sourceTimeMs <= seg.sourceEndMs) {
      const sourceOffset = sourceTimeMs - seg.sourceStartMs;
      return seg.outputStartMs + sourceOffset / seg.playbackRate;
    }
  }
  return null;
}

function mergeActionWindows(times: number[], sourceDurationMs: number, cfg: ActionPlaybackConfig): ActionWindow[] {
  const windows: ActionWindow[] = [];
  for (const t of times) {
    const start = Math.max(0, t - cfg.preActionPaddingMs);
    const end = Math.min(sourceDurationMs, Math.max(start + 1, t + cfg.postActionPaddingMs));
    const last = windows[windows.length - 1];
    if (last && start <= last.end) {
      last.end = Math.max(last.end, end);
    } else {
      windows.push({ start, end });
    }
  }
  return windows;
}

function normalizeWindows(windows: ActionWindow[], sourceDurationMs: number): ActionWindow[] {
  const sorted = windows
    .map((window) => ({
      start: clamp(window.start, 0, sourceDurationMs),
      end: clamp(window.end, 0, sourceDurationMs),
    }))
    .filter((window) => window.end > window.start)
    .sort((a, b) => a.start - b.start);

  const merged: ActionWindow[] = [];
  for (const window of sorted) {
    const last = merged[merged.length - 1];
    if (last && window.start <= last.end) {
      last.end = Math.max(last.end, window.end);
    } else {
      merged.push({ ...window });
    }
  }
  return merged;
}

function buildSegments(windows: ActionWindow[], cfg: ActionPlaybackConfig): PlaybackSegment[] {
  const segments: PlaybackSegment[] = [];
  let outputTime = 0;
  let lastSourceEnd = windows[0]!.start;

  for (const window of windows) {
    if (window.start > lastSourceEnd) {
      const gap = buildGapSegment(lastSourceEnd, window.start, outputTime, cfg);
      segments.push(gap);
      outputTime += gap.outputDurationMs;
    }

    const actionDuration = window.end - window.start;
    segments.push({
      type: "action",
      sourceStartMs: window.start,
      sourceEndMs: window.end,
      sourceDurationMs: actionDuration,
      outputStartMs: outputTime,
      outputEndMs: outputTime + actionDuration,
      outputDurationMs: actionDuration,
      playbackRate: 1,
    });
    outputTime += actionDuration;
    lastSourceEnd = window.end;
  }

  return segments;
}

function buildGapSegment(
  sourceStart: number,
  sourceEnd: number,
  outputStart: number,
  cfg: ActionPlaybackConfig,
): PlaybackSegment {
  const sourceDuration = sourceEnd - sourceStart;
  let playbackRate = 1;
  let outputDuration = sourceDuration;

  if (sourceDuration > cfg.minGapToSpeedUpMs) {
    const idealRate = sourceDuration / cfg.targetGapOutputMs;
    playbackRate = clamp(idealRate, 1, cfg.maxPlaybackRate);
    outputDuration = sourceDuration / playbackRate;
    if (outputDuration > cfg.maxGapOutputMs) {
      outputDuration = cfg.maxGapOutputMs;
      playbackRate = sourceDuration / outputDuration;
    }
  }

  return {
    type: "gap",
    sourceStartMs: sourceStart,
    sourceEndMs: sourceEnd,
    sourceDurationMs: sourceDuration,
    outputStartMs: outputStart,
    outputEndMs: outputStart + outputDuration,
    outputDurationMs: outputDuration,
    playbackRate,
  };
}

function fitPlaybackPlanToDuration(plan: PlaybackPlan, targetDurationMs: number): PlaybackPlan {
  if (targetDurationMs >= plan.outputDurationMs) return stretchActionsToDuration(plan, targetDurationMs);
  return scalePlaybackPlanToDuration(plan, targetDurationMs);
}

function stretchActionsToDuration(plan: PlaybackPlan, targetDurationMs: number): PlaybackPlan {
  const actionTotal = plan.segments
    .filter((seg) => seg.type === "action")
    .reduce((sum, seg) => sum + seg.outputDurationMs, 0);

  if (actionTotal <= 0) return scalePlaybackPlanToDuration(plan, targetDurationMs);

  const gapTotal = plan.segments
    .filter((seg) => seg.type === "gap")
    .reduce((sum, seg) => sum + seg.outputDurationMs, 0);
  const targetActionTotal = Math.max(1, targetDurationMs - gapTotal);
  const actionScale = targetActionTotal / actionTotal;

  let outputTime = 0;
  const segments = plan.segments.map((seg, i): PlaybackSegment => {
    const isLast = i === plan.segments.length - 1;
    const outputDuration = isLast
      ? targetDurationMs - outputTime
      : seg.type === "action"
        ? seg.outputDurationMs * actionScale
        : seg.outputDurationMs;
    const playbackRate = seg.sourceDurationMs / Math.max(outputDuration, 1);
    const next: PlaybackSegment = {
      ...seg,
      outputStartMs: outputTime,
      outputEndMs: outputTime + outputDuration,
      outputDurationMs: outputDuration,
      playbackRate,
    };
    outputTime += outputDuration;
    return next;
  });
  return { ...plan, segments, outputDurationMs: targetDurationMs, fittedToDurationMs: targetDurationMs };
}

function scalePlaybackPlanToDuration(plan: PlaybackPlan, targetDurationMs: number): PlaybackPlan {
  const scale = targetDurationMs / plan.outputDurationMs;
  let outputTime = 0;
  const segments = plan.segments.map((seg, i): PlaybackSegment => {
    const isLast = i === plan.segments.length - 1;
    const outputDuration = isLast ? targetDurationMs - outputTime : seg.outputDurationMs * scale;
    const playbackRate = seg.sourceDurationMs / Math.max(outputDuration, 1);
    const next: PlaybackSegment = {
      ...seg,
      outputStartMs: outputTime,
      outputEndMs: outputTime + outputDuration,
      outputDurationMs: outputDuration,
      playbackRate,
    };
    outputTime += outputDuration;
    return next;
  });
  return { ...plan, segments, outputDurationMs: targetDurationMs, fittedToDurationMs: targetDurationMs };
}

function dropUndefined(config: Partial<ActionPlaybackConfig> | undefined): Partial<ActionPlaybackConfig> {
  if (!config) return {};
  return Object.fromEntries(Object.entries(config).filter(([, value]) => value !== undefined));
}

function clamp(value: number, lo: number, hi: number): number {
  return Math.min(hi, Math.max(lo, value));
}
