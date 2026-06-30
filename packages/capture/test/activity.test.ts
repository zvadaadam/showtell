import { test, expect } from "bun:test";
import { execFileSync } from "node:child_process";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { alignEventsToVisualActivity, analyzeVisualActivity, createVisualPlaybackPlan } from "../src/index.ts";

test("visual activity aligns command-window events to the moving pixels", () => {
  const [event] = alignEventsToVisualActivity(
    [{ t: 3000, startT: 1000, endT: 3000, type: "click", x: 80, y: 45 }],
    [{ startMs: 1600, endMs: 2200 }],
  );
  expect(event!.t).toBe(1900);
  expect(event!.startT).toBe(1000);
  expect(event!.endT).toBe(3000);
});

test("visual activity detects moving intervals without event metadata", () => {
  const dir = mkdtempSync(join(tmpdir(), "av-activity-"));
  try {
    const video = join(dir, "activity.mp4");
    execFileSync("ffmpeg", [
      "-y",
      "-loglevel",
      "error",
      "-f",
      "lavfi",
      "-i",
      "color=c=black:size=160x90:rate=30:d=1",
      "-f",
      "lavfi",
      "-i",
      "testsrc=size=160x90:rate=30:d=1",
      "-f",
      "lavfi",
      "-i",
      "color=c=black:size=160x90:rate=30:d=2",
      "-f",
      "lavfi",
      "-i",
      "testsrc2=size=160x90:rate=30:d=1",
      "-f",
      "lavfi",
      "-i",
      "color=c=black:size=160x90:rate=30:d=1",
      "-filter_complex",
      "[0:v][1:v][2:v][3:v][4:v]concat=n=5:v=1:a=0,format=yuv420p[v]",
      "-map",
      "[v]",
      video,
    ]);

    const activity = analyzeVisualActivity({ source: video, sourceSize: { width: 160, height: 90 } });
    expect(activity.intervals.length).toBeGreaterThanOrEqual(2);
    expect(activity.intervals[0]!.startMs).toBeGreaterThan(700);
    expect(activity.events.length).toBe(activity.intervals.length);

    const plan = createVisualPlaybackPlan(
      activity.intervals,
      6000,
      { preActionPaddingMs: 100, postActionPaddingMs: 150, targetGapOutputMs: 250, maxGapOutputMs: 250 },
      2500,
    );
    expect(plan).not.toBeNull();
    expect(plan!.droppedBeforeMs).toBeGreaterThan(700);
    expect(plan!.outputDurationMs).toBe(2500);
    expect(plan!.segments.some((seg) => seg.type === "gap" && seg.playbackRate > 1)).toBe(true);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}, 30_000);

test("visual activity keeps full-frame changes into flat visible screens", () => {
  const dir = mkdtempSync(join(tmpdir(), "av-activity-flat-"));
  try {
    const video = join(dir, "flat.mp4");
    execFileSync("ffmpeg", [
      "-y",
      "-loglevel",
      "error",
      "-f",
      "lavfi",
      "-i",
      "color=c=black:size=160x90:rate=30:d=1",
      "-f",
      "lavfi",
      "-i",
      "color=c=blue:size=160x90:rate=30:d=1",
      "-filter_complex",
      "[0:v][1:v]concat=n=2:v=1:a=0,format=yuv420p[v]",
      "-map",
      "[v]",
      video,
    ]);

    const activity = analyzeVisualActivity({ source: video, sourceSize: { width: 160, height: 90 } });
    expect(activity.intervals.length).toBeGreaterThan(0);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}, 30_000);
