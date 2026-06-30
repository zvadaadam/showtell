import { test, expect } from "bun:test";
import {
  createActionPlaybackPlan,
  createSmartPlaybackPlan,
  remapEventsToPlayback,
  type CaptureEvent,
} from "../src/index.ts";

const events: CaptureEvent[] = [
  { t: 3000, type: "click", x: 1200, y: 300 },
  { t: 7000, type: "type", x: 900, y: 500 },
  { t: 9000, type: "idle", x: 640, y: 360 },
];

test("action playback trims leading/trailing dead time and compresses gaps", () => {
  const plan = createActionPlaybackPlan(events, 10_000, {
    preActionPaddingMs: 500,
    postActionPaddingMs: 500,
    targetGapOutputMs: 1000,
    maxGapOutputMs: 1000,
    minGapToSpeedUpMs: 800,
  });
  expect(plan).not.toBeNull();
  expect(plan!.segments[0]!.sourceStartMs).toBe(2500);
  expect(plan!.segments.at(-1)!.sourceEndMs).toBe(7500);
  expect(plan!.droppedBeforeMs).toBe(2500);
  expect(plan!.droppedAfterMs).toBe(2500);
  expect(plan!.segments.some((s) => s.type === "gap" && s.playbackRate > 1)).toBe(true);
});

test("action playback can fit exactly to narration duration", () => {
  const plan = createActionPlaybackPlan(events, 10_000, { preActionPaddingMs: 500, postActionPaddingMs: 500 }, 6000);
  expect(plan!.outputDurationMs).toBe(6000);
  expect(plan!.segments.at(-1)!.outputEndMs).toBe(6000);
});

test("fitting longer narration stretches action windows, not dead gaps", () => {
  const config = {
    preActionPaddingMs: 500,
    postActionPaddingMs: 500,
    targetGapOutputMs: 500,
    maxGapOutputMs: 500,
  };
  const base = createActionPlaybackPlan(events, 10_000, config)!;
  const fitted = createActionPlaybackPlan(events, 10_000, config, 6000)!;
  const baseGaps = base.segments.filter((s) => s.type === "gap").map((s) => Math.round(s.outputDurationMs));
  const fittedGaps = fitted.segments.filter((s) => s.type === "gap").map((s) => Math.round(s.outputDurationMs));
  expect(fittedGaps).toEqual(baseGaps);
});

test("events are remapped onto the action-only output timeline", () => {
  const plan = createActionPlaybackPlan(events, 10_000, { preActionPaddingMs: 500, postActionPaddingMs: 500 }, 6000)!;
  const remapped = remapEventsToPlayback(events, plan);
  expect(remapped.map((e) => e.type)).toEqual(["click", "type"]);
  expect(remapped[0]!.t).toBeGreaterThan(0);
  expect(remapped[0]!.t).toBeLessThan(remapped[1]!.t);
});

test("action playback preserves command event windows", () => {
  const plan = createActionPlaybackPlan([{ t: 1100, startT: 900, endT: 1100, type: "click", x: 80, y: 45 }], 2000, {
    preActionPaddingMs: 0,
    postActionPaddingMs: 0,
  });
  expect(plan).not.toBeNull();
  expect(plan!.segments).toHaveLength(1);
  expect(plan!.segments[0]).toMatchObject({
    type: "action",
    sourceStartMs: 900,
    sourceEndMs: 1100,
    sourceDurationMs: 200,
  });
});

test("smart playback merges event hints with delayed visual activity", () => {
  const plan = createSmartPlaybackPlan({
    events: [{ t: 1000, type: "click", x: 100, y: 100 }],
    visualWindows: [{ startMs: 1600, endMs: 2600 }],
    sourceDurationMs: 5000,
    config: { preActionPaddingMs: 100, postActionPaddingMs: 100 },
  });
  expect(plan).not.toBeNull();
  expect(plan!.segments[0]!.sourceStartMs).toBe(900);
  expect(plan!.segments.at(-1)!.sourceEndMs).toBe(2700);
});

test("smart playback preserves command event windows", () => {
  const plan = createSmartPlaybackPlan({
    events: [{ t: 3000, startT: 1000, endT: 3000, type: "click", x: 80, y: 45 }],
    visualWindows: [],
    sourceDurationMs: 5000,
    config: { preActionPaddingMs: 0, postActionPaddingMs: 0 },
  });
  expect(plan).not.toBeNull();
  expect(plan!.segments[0]).toMatchObject({
    type: "action",
    sourceStartMs: 1000,
    sourceEndMs: 3000,
    sourceDurationMs: 2000,
  });
});
