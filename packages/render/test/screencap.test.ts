import { test, expect, beforeAll, afterAll } from "bun:test";
import { execFileSync } from "node:child_process";
import { mkdtempSync, mkdirSync, rmSync, existsSync } from "node:fs";
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
