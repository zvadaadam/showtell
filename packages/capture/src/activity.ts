import { execFileSync } from "node:child_process";
import type { ActivityWindow } from "./playback.ts";
import type { CaptureEvent } from "./camera.ts";

export interface VisualActivityInterval extends ActivityWindow {
  x: number;
  y: number;
  score: number;
  coverage: number;
}

export interface VisualActivityResult {
  intervals: VisualActivityInterval[];
  events: CaptureEvent[];
  sampleCount: number;
  sampleFps: number;
  sourceSize: { width: number; height: number };
}

export interface VisualActivityConfig {
  sampleFps: number;
  sampleWidth: number;
  sampleHeight: number;
  pixelDiffThreshold: number;
  minChangedPixelRatio: number;
  minScore: number;
  minCurrentFrameVariance: number;
  minCurrentFrameMean: number;
  mergeGapMs: number;
  minIntervalMs: number;
}

export const DEFAULT_VISUAL_ACTIVITY_CONFIG: VisualActivityConfig = {
  sampleFps: 4,
  sampleWidth: 96,
  sampleHeight: 54,
  pixelDiffThreshold: 10,
  minChangedPixelRatio: 0.004,
  minScore: 0.7,
  minCurrentFrameVariance: 2,
  minCurrentFrameMean: 2,
  mergeGapMs: 500,
  minIntervalMs: 120,
};

interface SampleActivity {
  startMs: number;
  endMs: number;
  x: number;
  y: number;
  score: number;
  coverage: number;
}

export function analyzeVisualActivity(opts: {
  source: string;
  sourceStartSec?: number;
  sourceDurationSec?: number;
  sourceSize?: { width: number; height: number };
  config?: Partial<VisualActivityConfig>;
}): VisualActivityResult {
  const cfg = { ...DEFAULT_VISUAL_ACTIVITY_CONFIG, ...dropUndefined(opts.config) };
  const sourceSize = opts.sourceSize ?? probeVideoSize(opts.source);
  const frameBytes = cfg.sampleWidth * cfg.sampleHeight;
  const raw = sampleGrayFrames(opts.source, cfg, opts.sourceStartSec, opts.sourceDurationSec);
  const sampleCount = Math.floor(raw.length / frameBytes);
  if (sampleCount < 2) {
    return { intervals: [], events: [], sampleCount, sampleFps: cfg.sampleFps, sourceSize };
  }

  const samples: SampleActivity[] = [];
  for (let i = 1; i < sampleCount; i++) {
    const prev = raw.subarray((i - 1) * frameBytes, i * frameBytes);
    const cur = raw.subarray(i * frameBytes, (i + 1) * frameBytes);
    const activity = compareFrames(prev, cur, cfg, sourceSize);
    if (!activity) continue;
    samples.push({
      startMs: (i / cfg.sampleFps) * 1000,
      endMs: ((i + 1) / cfg.sampleFps) * 1000,
      ...activity,
    });
  }

  const intervals = mergeSamples(samples, cfg);
  const events = intervals.map(
    (interval): CaptureEvent => ({
      t: (interval.startMs + interval.endMs) / 2,
      type: interval.coverage > 0.28 ? "navigate" : "scroll",
      x: interval.x,
      y: interval.y,
    }),
  );
  return { intervals, events, sampleCount, sampleFps: cfg.sampleFps, sourceSize };
}

export function alignEventsToVisualActivity(events: CaptureEvent[], intervals: ActivityWindow[]): CaptureEvent[] {
  if (events.length === 0 || intervals.length === 0) return events;
  return events.map((event) => {
    const match = bestIntervalForEvent(event, intervals);
    if (!match) return event;
    return { ...event, t: match };
  });
}

function bestIntervalForEvent(event: CaptureEvent, intervals: ActivityWindow[]): number | null {
  const start = event.startT ?? event.t;
  const end = event.endT ?? event.t;
  const rangeStart = Math.min(start, end);
  const rangeEnd = Math.max(start, end);
  let best: { overlapMs: number; t: number } | null = null;

  for (const interval of intervals) {
    const overlapStart = Math.max(rangeStart, interval.startMs);
    const overlapEnd = Math.min(rangeEnd, interval.endMs);
    const pointInside = rangeStart === rangeEnd && interval.startMs <= rangeStart && rangeStart <= interval.endMs;
    if (!pointInside && overlapEnd <= overlapStart) continue;

    const overlapMs = pointInside ? 1 : overlapEnd - overlapStart;
    const t = pointInside ? rangeStart : (overlapStart + overlapEnd) / 2;
    if (!best || overlapMs > best.overlapMs) best = { overlapMs, t };
  }

  return best?.t ?? null;
}

function sampleGrayFrames(
  source: string,
  cfg: VisualActivityConfig,
  sourceStartSec: number | undefined,
  sourceDurationSec: number | undefined,
): Buffer {
  const args = ["-v", "error"];
  if (sourceStartSec && sourceStartSec > 0) args.push("-ss", sourceStartSec.toFixed(3));
  if (sourceDurationSec && sourceDurationSec > 0) args.push("-t", sourceDurationSec.toFixed(3));
  args.push(
    "-i",
    source,
    "-vf",
    `fps=${cfg.sampleFps},scale=${cfg.sampleWidth}:${cfg.sampleHeight}:flags=bilinear,format=gray`,
    "-f",
    "rawvideo",
    "-",
  );
  return execFileSync("ffmpeg", args, { maxBuffer: 64 * 1024 * 1024 });
}

function compareFrames(
  prev: Buffer,
  cur: Buffer,
  cfg: VisualActivityConfig,
  sourceSize: { width: number; height: number },
): { x: number; y: number; score: number; coverage: number } | null {
  let changed = 0;
  let weightedX = 0;
  let weightedY = 0;
  let totalWeight = 0;
  let totalDiff = 0;
  let curSum = 0;
  let curSumSq = 0;

  for (let y = 0; y < cfg.sampleHeight; y++) {
    for (let x = 0; x < cfg.sampleWidth; x++) {
      const idx = y * cfg.sampleWidth + x;
      const curValue = cur[idx]!;
      curSum += curValue;
      curSumSq += curValue * curValue;
      const diff = Math.abs(curValue - prev[idx]!);
      totalDiff += diff;
      if (diff < cfg.pixelDiffThreshold) continue;
      changed++;
      totalWeight += diff;
      weightedX += x * diff;
      weightedY += y * diff;
    }
  }

  const pixels = cfg.sampleWidth * cfg.sampleHeight;
  const coverage = changed / pixels;
  const score = totalDiff / pixels;
  const mean = curSum / pixels;
  const variance = curSumSq / pixels - mean * mean;
  if (
    coverage < cfg.minChangedPixelRatio ||
    score < cfg.minScore ||
    (variance < cfg.minCurrentFrameVariance && mean < cfg.minCurrentFrameMean) ||
    totalWeight <= 0
  ) {
    return null;
  }

  const sampleX = weightedX / totalWeight;
  const sampleY = weightedY / totalWeight;
  return {
    x: (sampleX / Math.max(1, cfg.sampleWidth - 1)) * sourceSize.width,
    y: (sampleY / Math.max(1, cfg.sampleHeight - 1)) * sourceSize.height,
    score,
    coverage,
  };
}

function mergeSamples(samples: SampleActivity[], cfg: VisualActivityConfig): VisualActivityInterval[] {
  const intervals: VisualActivityInterval[] = [];
  for (const sample of samples) {
    const last = intervals[intervals.length - 1];
    if (last && sample.startMs - last.endMs <= cfg.mergeGapMs) {
      const lastWeight = last.score * Math.max(1, last.endMs - last.startMs);
      const sampleWeight = sample.score * Math.max(1, sample.endMs - sample.startMs);
      const weight = lastWeight + sampleWeight;
      last.endMs = sample.endMs;
      last.x = (last.x * lastWeight + sample.x * sampleWeight) / weight;
      last.y = (last.y * lastWeight + sample.y * sampleWeight) / weight;
      last.score = Math.max(last.score, sample.score);
      last.coverage = Math.max(last.coverage, sample.coverage);
      continue;
    }
    intervals.push({ ...sample });
  }

  return intervals.filter((interval) => interval.endMs - interval.startMs >= cfg.minIntervalMs);
}

function probeVideoSize(path: string): { width: number; height: number } {
  const out = execFileSync(
    "ffprobe",
    ["-v", "error", "-select_streams", "v:0", "-show_entries", "stream=width,height", "-of", "csv=p=0", path],
    { encoding: "utf-8" },
  )
    .trim()
    .split(",");
  const width = Number(out[0]);
  const height = Number(out[1]);
  if (!Number.isFinite(width) || !Number.isFinite(height) || width <= 0 || height <= 0) {
    throw new Error(`Could not probe video size for ${path}`);
  }
  return { width, height };
}

function dropUndefined<T extends Record<string, unknown>>(config: Partial<T> | undefined): Partial<T> {
  if (!config) return {};
  return Object.fromEntries(Object.entries(config).filter(([, value]) => value !== undefined)) as Partial<T>;
}
