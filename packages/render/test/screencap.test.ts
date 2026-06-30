import { test, expect, beforeAll, afterAll } from "bun:test";
import { execFileSync } from "node:child_process";
import { mkdtempSync, mkdirSync, rmSync, existsSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { VideoSpec } from "@agent-video/core";
import { renderVideo, probeDurationMs } from "../src/index.ts";

let repo: string;
let outDir: string;

beforeAll(() => {
  repo = mkdtempSync(join(tmpdir(), "av-screencap-"));
  outDir = join(repo, "out");
  const caps = join(repo, ".agent-video", "captures");
  mkdirSync(caps, { recursive: true });
  // Synthetic "screen recording" stands in for a real avfoundation capture.
  execFileSync("ffmpeg", [
    "-y",
    "-loglevel",
    "error",
    "-f",
    "lavfi",
    "-i",
    "testsrc=size=1280x720:rate=30:duration=3",
    "-pix_fmt",
    "yuv420p",
    join(caps, "syn.mp4"),
  ]);
});
afterAll(() => rmSync(repo, { recursive: true, force: true }));

const spec: VideoSpec = {
  meta: {
    title: "sc",
    fps: 30,
    aspectRatios: ["16:9"],
    watermark: true,
    tts: { provider: "say" },
    repo: { path: "." },
  },
  scenes: [
    { kind: "title", content: { heading: "Demo" }, narration: "watch.", duration: "auto" },
    {
      kind: "screencap",
      content: { source: "desktop", sessionRef: "syn" },
      narration: "the app runs here.",
      duration: "auto",
    },
  ],
};

function firstFrameAverageRgb(path: string): { r: number; g: number; b: number } {
  return frameAverageRgb(path, 0);
}

function frameAverageRgb(path: string, atSec: number): { r: number; g: number; b: number } {
  const seek = atSec > 0 ? ["-ss", atSec.toFixed(3)] : [];
  const buf = execFileSync(
    "ffmpeg",
    ["-v", "error", ...seek, "-i", path, "-frames:v", "1", "-f", "rawvideo", "-pix_fmt", "rgb24", "-"],
    {
      maxBuffer: 16 * 1024 * 1024,
    },
  );
  let r = 0;
  let g = 0;
  let b = 0;
  const pixels = buf.length / 3;
  for (let i = 0; i < buf.length; i += 3) {
    r += buf[i]!;
    g += buf[i + 1]!;
    b += buf[i + 2]!;
  }
  return { r: r / pixels, g: g / pixels, b: b / pixels };
}

test("screencap composites into a valid mp4 (not skipped)", async () => {
  const r = await renderVideo(spec, { repoPath: repo, outDir, baseName: "sc", aspectRatios: ["16:9"] });
  expect(r.skipped).toHaveLength(0);
  expect(r.scenes.some((s) => s.kind === "screencap")).toBe(true);
  const out = r.outputs[0]!;
  expect(existsSync(out.path)).toBe(true);

  const streams = execFileSync(
    "ffprobe",
    ["-v", "error", "-show_entries", "stream=codec_type,width,height", "-of", "csv=p=0", out.path],
    { encoding: "utf-8" },
  );
  expect(streams).toContain("video,1920,1080");
  expect(streams).toContain("audio");

  // total ≈ title + screencap durations (synced to narration)
  const sum = r.scenes.reduce((a, s) => a + s.durationSec, 0);
  expect(Math.abs(probeDurationMs(out.path) / 1000 - sum)).toBeLessThan(0.3);
}, 40_000);

test("missing capture session fails with an actionable error", async () => {
  const bad: VideoSpec = {
    ...spec,
    scenes: [
      { kind: "screencap", content: { source: "desktop", sessionRef: "nope" }, narration: "x", duration: "auto" },
    ],
  };
  expect(renderVideo(bad, { repoPath: repo, outDir, baseName: "bad", aspectRatios: ["16:9"] })).rejects.toThrow(
    /not found/,
  );
}, 20_000);

test("screencap clip range is passed through to the compositor", async () => {
  const caps = join(repo, ".agent-video", "captures");
  execFileSync("ffmpeg", [
    "-y",
    "-loglevel",
    "error",
    "-f",
    "lavfi",
    "-i",
    "color=c=red:size=160x90:rate=30:d=1",
    "-f",
    "lavfi",
    "-i",
    "color=c=blue:size=160x90:rate=30:d=1",
    "-filter_complex",
    "[0:v][1:v]concat=n=2:v=1:a=0,format=yuv420p[v]",
    "-map",
    "[v]",
    join(caps, "redblue.mp4"),
  ]);
  const clipSpec: VideoSpec = {
    meta: {
      title: "clip",
      fps: 30,
      aspectRatios: ["16:9"],
      watermark: false,
      tts: { provider: "say" },
      repo: { path: "." },
    },
    scenes: [
      {
        kind: "screencap",
        content: { source: "desktop", sessionRef: "redblue", clip: { start: 1, end: 1.5 } },
        narration: "clip.",
        duration: 0.5,
      },
    ],
  };
  const r = await renderVideo(clipSpec, { repoPath: repo, outDir, baseName: "clip", aspectRatios: ["16:9"] });
  const avg = firstFrameAverageRgb(r.outputs[0]!.path);
  expect(avg.b).toBeGreaterThan(avg.r);
}, 40_000);

test("screencap action-only playback drops dead lead-in around events", async () => {
  const caps = join(repo, ".agent-video", "captures");
  execFileSync("ffmpeg", [
    "-y",
    "-loglevel",
    "error",
    "-f",
    "lavfi",
    "-i",
    "color=c=red:size=160x90:rate=30:d=1",
    "-f",
    "lavfi",
    "-i",
    "color=c=blue:size=160x90:rate=30:d=1",
    "-f",
    "lavfi",
    "-i",
    "color=c=green:size=160x90:rate=30:d=1",
    "-filter_complex",
    "[0:v][1:v][2:v]concat=n=3:v=1:a=0,format=yuv420p[v]",
    "-map",
    "[v]",
    join(caps, "action.mp4"),
  ]);
  writeFileSync(join(caps, "action.events.json"), JSON.stringify([{ t: 1500, type: "click", x: 80, y: 45 }]));

  const actionSpec: VideoSpec = {
    meta: {
      title: "action",
      fps: 30,
      aspectRatios: ["16:9"],
      watermark: false,
      tts: { provider: "say" },
      repo: { path: "." },
    },
    scenes: [
      {
        kind: "screencap",
        content: {
          source: "browser",
          sessionRef: "action",
          playback: { mode: "action-only", preActionPaddingMs: 0, postActionPaddingMs: 400 },
        },
        narration: "click.",
        duration: 0.4,
      },
    ],
  };

  const r = await renderVideo(actionSpec, { repoPath: repo, outDir, baseName: "action", aspectRatios: ["16:9"] });
  const avg = firstFrameAverageRgb(r.outputs[0]!.path);
  expect(avg.b).toBeGreaterThan(avg.r);
}, 40_000);

test("portrait screencaps default to full-frame action effects instead of zoom camera", async () => {
  const caps = join(repo, ".agent-video", "captures");
  execFileSync("ffmpeg", [
    "-y",
    "-loglevel",
    "error",
    "-f",
    "lavfi",
    "-i",
    "color=c=red:size=80x320:rate=30:d=1",
    "-f",
    "lavfi",
    "-i",
    "color=c=blue:size=80x320:rate=30:d=1",
    "-filter_complex",
    "[0:v][1:v]hstack=inputs=2,format=yuv420p[v]",
    "-map",
    "[v]",
    join(caps, "portrait.mp4"),
  ]);
  writeFileSync(join(caps, "portrait.events.json"), JSON.stringify([{ t: 0, type: "click", x: 145, y: 160 }]));

  const mobileSpec: VideoSpec = {
    meta: {
      title: "portrait",
      fps: 30,
      aspectRatios: ["9:16"],
      watermark: false,
      tts: { provider: "say" },
      repo: { path: "." },
    },
    scenes: [
      {
        kind: "screencap",
        content: {
          source: "app",
          sessionRef: "portrait",
          playback: { mode: "realtime", actionEffects: "none" },
        },
        narration: "tap.",
        duration: 1,
      },
    ],
  };
  const followSpec: VideoSpec = {
    ...mobileSpec,
    scenes: [
      {
        kind: "screencap",
        content: {
          source: "app",
          sessionRef: "portrait",
          playback: { mode: "realtime", camera: "follow", actionEffects: "none" },
        },
        narration: "tap.",
        duration: 1,
      },
    ],
  };

  const mobile = await renderVideo(mobileSpec, {
    repoPath: repo,
    outDir: join(outDir, "portrait-auto"),
    baseName: "portrait-auto",
    aspectRatios: ["9:16"],
  });
  const follow = await renderVideo(followSpec, {
    repoPath: repo,
    outDir: join(outDir, "portrait-follow"),
    baseName: "portrait-follow",
    aspectRatios: ["9:16"],
  });

  const fullFrame = frameAverageRgb(mobile.outputs[0]!.path, 0.8);
  const zoomed = frameAverageRgb(follow.outputs[0]!.path, 0.8);
  expect(Math.abs(fullFrame.r - fullFrame.b)).toBeLessThan(35);
  expect(zoomed.b).toBeGreaterThan(zoomed.r + 35);
}, 40_000);

test("screencap smart playback drops visually idle time without event metadata", async () => {
  const caps = join(repo, ".agent-video", "captures");
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
    "color=c=black:size=160x90:rate=30:d=3",
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
    join(caps, "smart.mp4"),
  ]);

  const smartSpec: VideoSpec = {
    meta: {
      title: "smart",
      fps: 30,
      aspectRatios: ["16:9"],
      watermark: false,
      tts: { provider: "say" },
      repo: { path: "." },
    },
    scenes: [
      {
        kind: "screencap",
        content: {
          source: "browser",
          sessionRef: "smart",
          playback: {
            mode: "smart",
            preActionPaddingMs: 0,
            postActionPaddingMs: 100,
            targetGapOutputMs: 200,
            maxGapOutputMs: 200,
          },
        },
        narration: "activity.",
        duration: 2.2,
      },
    ],
  };

  const r = await renderVideo(smartSpec, { repoPath: repo, outDir, baseName: "smart", aspectRatios: ["16:9"] });
  const first = firstFrameAverageRgb(r.outputs[0]!.path);
  expect(first.r + first.g + first.b).toBeGreaterThan(30);
  expect(r.warnings).toHaveLength(0);
  expect(probeDurationMs(r.outputs[0]!.path) / 1000).toBeLessThan(2.5);
}, 40_000);
