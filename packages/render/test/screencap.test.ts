import { test, expect, beforeAll, afterAll } from "bun:test";
import { execFileSync, spawnSync } from "node:child_process";
import { mkdtempSync, mkdirSync, rmSync, existsSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { VideoSpec } from "@showtell/core";
import { renderVideo, probeDurationMs, renderBundle } from "../src/index.ts";
import { fitAudioToDuration, silentAudio } from "../src/ffmpeg.ts";
import {
  buildScreencapCompositeOptions,
  type ScreencapClipRequest,
  type ScreencapPresentation,
} from "../src/screencap.ts";

let repo: string;
let outDir: string;

beforeAll(() => {
  repo = mkdtempSync(join(tmpdir(), "av-screencap-"));
  outDir = join(repo, "out");
  const caps = join(repo, ".showtell", "captures");
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

test("screencap presentation maps every timing, effect, audio, and overlay field to capture", () => {
  const presentation: ScreencapPresentation = {
    source: "/captures/session.mp4",
    sourceStartSec: 1.25,
    sourceDurationSec: 2.5,
    sourceSize: { width: 1440, height: 900 },
    playbackPlan: {
      segments: [
        {
          type: "action",
          sourceStartMs: 1250,
          sourceEndMs: 1750,
          sourceDurationMs: 500,
          outputStartMs: 0,
          outputEndMs: 500,
          outputDurationMs: 500,
          playbackRate: 1,
        },
      ],
      sourceDurationMs: 2500,
      outputDurationMs: 500,
      droppedBeforeMs: 1250,
      droppedAfterMs: 750,
      actionCount: 1,
    },
    camera: [{ t: 0, x: 720, y: 450, zoom: 1.8 }],
    actionEffects: [{ t: 0, type: "click", x: 720, y: 450 }],
    warnings: ["reported before capture"],
  };
  const request: Omit<ScreencapClipRequest, "sceneIndex" | "capture" | "repoPath"> = {
    outPath: "/work/scene.mp4",
    width: 1920,
    height: 1080,
    durationSec: 0.5,
    fps: 30,
    audio: "/work/narration.wav",
    overlays: [{ png: "/work/watermark.png" }, { png: "/work/caption.png", enableStartSec: 0.1, enableEndSec: 0.4 }],
  };

  expect(buildScreencapCompositeOptions(presentation, request)).toEqual({
    source: "/captures/session.mp4",
    sourceStartSec: 1.25,
    sourceDurationSec: 2.5,
    outPath: "/work/scene.mp4",
    width: 1920,
    height: 1080,
    durationSec: 0.5,
    fps: 30,
    audio: "/work/narration.wav",
    overlays: [{ png: "/work/watermark.png" }, { png: "/work/caption.png", enableStartSec: 0.1, enableEndSec: 0.4 }],
    camera: [{ t: 0, x: 720, y: 450, zoom: 1.8 }],
    sourceSize: { width: 1440, height: 900 },
    playbackPlan: presentation.playbackPlan,
    actionEffects: [{ t: 0, type: "click", x: 720, y: 450 }],
  });
});

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

test("multi-aspect screencap preparation reports a playback fallback only once", async () => {
  const fallbackSpec: VideoSpec = {
    meta: {
      title: "fallback",
      fps: 30,
      aspectRatios: ["16:9", "9:16"],
      watermark: "showtell",
      tts: { provider: "say" },
      repo: { path: "." },
    },
    scenes: [
      {
        kind: "screencap",
        content: { source: "desktop", sessionRef: "syn", playback: { mode: "action-only" } },
        narration: "fallback.",
        duration: 0.3,
      },
    ],
  };

  const rendered = await renderVideo(fallbackSpec, {
    repoPath: repo,
    outDir: join(outDir, "fallback"),
    baseName: "fallback",
    aspectRatios: ["16:9", "9:16"],
  });

  expect(rendered.warnings).toEqual([
    {
      scene: 0,
      message: "screencap playback.mode=action-only needs a .events.json sidecar; rendering realtime.",
    },
  ]);
  expect(rendered.outputs.map((output) => output.aspectRatio)).toEqual(["16:9", "9:16"]);
  for (const output of rendered.outputs) {
    const streams = execFileSync(
      "ffprobe",
      ["-v", "error", "-show_entries", "stream=codec_type", "-of", "csv=p=0", output.path],
      { encoding: "utf-8" },
    );
    expect(streams).toContain("video");
    expect(streams).toContain("audio");
  }
}, 40_000);

test("screencap clip range is passed through to the compositor", async () => {
  const caps = join(repo, ".showtell", "captures");
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
  const caps = join(repo, ".showtell", "captures");
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

test("portrait screencaps default to full-frame instead of zoom camera", async () => {
  const caps = join(repo, ".showtell", "captures");
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

test("screencap clip ranges keep event windows that overlap the clip", async () => {
  const caps = join(repo, ".showtell", "captures");
  execFileSync("ffmpeg", [
    "-y",
    "-loglevel",
    "error",
    "-f",
    "lavfi",
    "-i",
    "testsrc=size=160x90:rate=30:duration=2",
    "-pix_fmt",
    "yuv420p",
    join(caps, "windowclip.mp4"),
  ]);
  writeFileSync(
    join(caps, "windowclip.events.json"),
    JSON.stringify([{ t: 900, startT: 900, endT: 1100, type: "click", x: 80, y: 45 }]),
  );

  const clipSpec: VideoSpec = {
    meta: {
      title: "windowclip",
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
          sessionRef: "windowclip",
          clip: { start: 1, end: 1.2 },
          playback: { mode: "action-only", preActionPaddingMs: 0, postActionPaddingMs: 100 },
        },
        narration: "clip.",
        duration: 0.2,
      },
    ],
  };

  const r = await renderVideo(clipSpec, {
    repoPath: repo,
    outDir: join(outDir, "windowclip"),
    baseName: "windowclip",
    aspectRatios: ["16:9"],
  });
  expect(r.warnings).toHaveLength(0);
}, 40_000);

test("screencap smart playback drops visually idle time without event metadata", async () => {
  const caps = join(repo, ".showtell", "captures");
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
  const late = frameAverageRgb(r.outputs[0]!.path, 2.0);
  expect(first.r + first.g + first.b).toBeGreaterThan(30);
  expect(late.r + late.g + late.b).toBeGreaterThan(30);
  expect(r.warnings).toHaveLength(0);
  expect(probeDurationMs(r.outputs[0]!.path) / 1000).toBeLessThan(2.5);
}, 40_000);

// 1x1 transparent PNG (presenter avatar fixture).
const tinyAvatarPng = Buffer.from(
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==",
  "base64",
);

function meanVolumeDb(path: string, startSec: number, endSec: number): number {
  const res = spawnSync(
    "ffmpeg",
    [
      "-hide_banner",
      "-nostats",
      "-i",
      path,
      "-af",
      `atrim=start=${startSec.toFixed(3)}:end=${endSec.toFixed(3)},volumedetect`,
      "-f",
      "null",
      "-",
    ],
    { encoding: "utf8" },
  );
  const match = /mean_volume:\s*(-?[\d.]+) dB/.exec(res.stderr);
  return match ? Number(match[1]) : -120;
}

function rawFrameAt(path: string, atSec: number): Buffer {
  const seek = atSec > 0 ? ["-ss", atSec.toFixed(3)] : [];
  return execFileSync(
    "ffmpeg",
    ["-v", "error", ...seek, "-i", path, "-frames:v", "1", "-f", "rawvideo", "-pix_fmt", "rgb24", "-"],
    { maxBuffer: 32 * 1024 * 1024 },
  );
}

function writeScreencapBundle(overrides: {
  captionsMode: "burn-in" | "sidecar";
  presenter: boolean;
  duration?: number;
}): string {
  const bundleDir = mkdtempSync(join(tmpdir(), "sc-bundle-"));
  if (overrides.presenter) {
    mkdirSync(join(bundleDir, "assets"), { recursive: true });
    writeFileSync(join(bundleDir, "assets", "avatar.png"), tinyAvatarPng);
  }
  const bundleSpec = {
    version: 3,
    meta: {
      title: "sc schedule",
      fps: 30,
      aspectRatios: ["16:9"],
      repo: { path: repo },
      ...(overrides.presenter ? { presenter: { image: "assets/avatar.png", model: "Claude" } } : {}),
    },
    audio: { tts: { provider: "say" }, captions: { mode: overrides.captionsMode, source: "narration" } },
    scenes: [
      {
        id: "demo",
        ...(overrides.duration === undefined ? {} : { duration: overrides.duration }),
        narration: {
          lines: [
            { id: "l1", text: "Line one." },
            { id: "l2", text: "Line two." },
          ],
        },
        visual: { kind: "screencap", sessionRef: "syn", playback: { mode: "realtime" } },
      },
    ],
  };
  writeFileSync(join(bundleDir, "spec.json"), JSON.stringify(bundleSpec, null, 2));
  return bundleDir;
}

test("fitAudioToDuration pads short and trims long narration to the scheduled span", () => {
  const work = mkdtempSync(join(tmpdir(), "fit-audio-"));
  const src = join(work, "src.wav");
  silentAudio(src, 0.5);
  const padded = join(work, "padded.wav");
  fitAudioToDuration(src, padded, 1.2);
  expect(Math.abs(probeDurationMs(padded) - 1200)).toBeLessThan(40);
  const trimmed = join(work, "trimmed.wav");
  fitAudioToDuration(src, trimmed, 0.25);
  expect(Math.abs(probeDurationMs(trimmed) - 250)).toBeLessThan(40);
  rmSync(work, { recursive: true, force: true });
});

test("screencap narration lands on the compiled schedule for explicit-duration scenes", async () => {
  const bundleDir = writeScreencapBundle({ captionsMode: "burn-in", presenter: false, duration: 6 });
  const result = await renderBundle(bundleDir, {
    outDir: mkdtempSync(join(tmpdir(), "sc-sched-out-")),
    aspectRatios: ["16:9"],
    cacheDir: join(repo, ".showtell-tts-cache"),
  });
  const mp4 = result.outputs[0]!.path;
  const scene = result.plan.scenes[0]!;
  const l2 = scene.narration.lines[1]!;
  const l2StartSec = (l2.startMs - scene.startMs) / 1000;
  // Speech must be audible inside line 2's scheduled span…
  expect(meanVolumeDb(mp4, l2StartSec + 0.15, l2StartSec + 0.9)).toBeGreaterThan(-45);
  // …and the stretch padding just before it must stay silent.
  expect(meanVolumeDb(mp4, l2StartSec - 0.9, l2StartSec - 0.15)).toBeLessThan(-55);
  rmSync(bundleDir, { recursive: true, force: true });
}, 120_000);

test("screencap scenes composite burn-in captions and presenter chrome", async () => {
  const cacheDir = join(repo, ".showtell-tts-cache");
  const withChrome = writeScreencapBundle({ captionsMode: "burn-in", presenter: true });
  const withoutChrome = writeScreencapBundle({ captionsMode: "sidecar", presenter: false });
  const a = await renderBundle(withChrome, {
    outDir: mkdtempSync(join(tmpdir(), "sc-chrome-a-")),
    aspectRatios: ["16:9"],
    cacheDir,
  });
  const b = await renderBundle(withoutChrome, {
    outDir: mkdtempSync(join(tmpdir(), "sc-chrome-b-")),
    aspectRatios: ["16:9"],
    cacheDir,
  });
  const sceneA = a.plan.scenes[0]!;
  const midLine1Sec =
    (sceneA.narration.lines[0]!.startMs - sceneA.startMs + sceneA.narration.lines[0]!.durationMs / 2) / 1000;
  const frameA = rawFrameAt(a.outputs[0]!.path, midLine1Sec);
  const frameB = rawFrameAt(b.outputs[0]!.path, midLine1Sec);
  expect(frameA.length).toBe(frameB.length);
  // Identical source and timestamp: any pixel difference is the caption/presenter chrome.
  expect(frameA.equals(frameB)).toBe(false);
  rmSync(withChrome, { recursive: true, force: true });
  rmSync(withoutChrome, { recursive: true, force: true });
}, 120_000);
