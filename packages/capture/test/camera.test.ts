import { test, expect, afterAll } from "bun:test";
import { mkdtempSync, rmSync, existsSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { execFileSync } from "node:child_process";
import { computeCameraTimeline, compositeScreencap, ensureSyntheticSession, type CaptureEvent } from "../src/index.ts";

function probeSize(path: string): string {
  return execFileSync(
    "ffprobe",
    ["-v", "error", "-select_streams", "v:0", "-show_entries", "stream=width,height", "-of", "csv=s=x:p=0", path],
    { encoding: "utf-8" },
  ).trim();
}

function firstFrameAverageRgb(path: string): { r: number; g: number; b: number } {
  const buf = execFileSync(
    "ffmpeg",
    ["-v", "error", "-i", path, "-frames:v", "1", "-f", "rawvideo", "-pix_fmt", "rgb24", "-"],
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

const source = { width: 1440, height: 900 };
const opts = { durationSec: 3, fps: 30, source };
const events: CaptureEvent[] = [
  { t: 0, type: "navigate", x: 720, y: 450 },
  { t: 600, type: "click", x: 1200, y: 200 },
  { t: 1800, type: "type", x: 1200, y: 220 },
];

test("timeline is deterministic (same input → same path)", () => {
  expect(computeCameraTimeline(events, opts)).toEqual(computeCameraTimeline(events, opts));
});

test("one keyframe per frame, starting centered at zoom 1", () => {
  const tl = computeCameraTimeline(events, opts);
  expect(tl).toHaveLength(90);
  expect(tl[0]!.zoom).toBeCloseTo(1, 1);
  expect(tl[0]!.x).toBeCloseTo(720, 0);
});

test("the camera zooms in toward a click target", () => {
  const tl = computeCameraTimeline(events, opts);
  const late = tl[45]!; // ~1.5s, after the click + during type
  expect(late.zoom).toBeGreaterThan(1.5);
  expect(late.x).toBeGreaterThan(720); // panned toward x=1200
});

test("the crop never escapes the source frame", () => {
  for (const k of computeCameraTimeline(events, opts)) {
    const halfW = source.width / (2 * k.zoom);
    const halfH = source.height / (2 * k.zoom);
    expect(k.x).toBeGreaterThanOrEqual(halfW - 0.5);
    expect(k.x).toBeLessThanOrEqual(source.width - halfW + 0.5);
    expect(k.y).toBeGreaterThanOrEqual(halfH - 0.5);
    expect(k.y).toBeLessThanOrEqual(source.height - halfH + 0.5);
  }
});

const root = mkdtempSync(join(tmpdir(), "av-cam-it-"));
afterAll(() => rmSync(root, { recursive: true, force: true }));

test("compositeScreencap applies the camera to a real clip", () => {
  const rec = ensureSyntheticSession("camclip", root, 3); // 1440x900 synthetic recording
  const out = join(root, "out.mp4");
  const camera = computeCameraTimeline(events, opts);
  compositeScreencap({
    source: rec,
    outPath: out,
    width: 1920,
    height: 1080,
    durationSec: 3,
    fps: 30,
    camera,
    sourceSize: source,
  });
  expect(existsSync(out)).toBe(true);
  expect(probeSize(out)).toBe("1920x1080");
}, 60_000);

test("compositeScreencap handles odd-dimension source recordings", () => {
  const rec = join(root, "odd.mp4");
  execFileSync("ffmpeg", [
    "-y",
    "-loglevel",
    "error",
    "-f",
    "lavfi",
    "-i",
    "testsrc=size=1279x721:rate=30:duration=1",
    "-pix_fmt",
    "yuv444p",
    rec,
  ]);
  const out = join(root, "odd-out.mp4");
  compositeScreencap({
    source: rec,
    outPath: out,
    width: 1920,
    height: 1080,
    durationSec: 1,
    fps: 30,
    camera: [{ t: 0, x: 1279 / 2, y: 721 / 2, zoom: 1 }],
    sourceSize: { width: 1279, height: 721 },
  });
  expect(probeSize(out)).toBe("1920x1080");
}, 60_000);

test("compositeScreencap honors sourceStartSec/sourceDurationSec", () => {
  const rec = join(root, "red-blue.mp4");
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
    rec,
  ]);
  const out = join(root, "clip-out.mp4");
  compositeScreencap({
    source: rec,
    sourceStartSec: 1,
    sourceDurationSec: 0.5,
    outPath: out,
    width: 160,
    height: 90,
    durationSec: 0.5,
    fps: 30,
  });
  const avg = firstFrameAverageRgb(out);
  expect(avg.b).toBeGreaterThan(avg.r);
}, 60_000);
