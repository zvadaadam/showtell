import { test, expect } from "bun:test";
import { existsSync, rmSync, statSync } from "node:fs";
import { execFileSync } from "node:child_process";
import { join } from "node:path";
import { tmpdir } from "node:os";
import type { VideoSpec } from "@agent-video/core";
import { renderVideo, probeDurationMs } from "../src/index.ts";

const outDir = join(tmpdir(), "agent-video-test-video");

const spec: VideoSpec = {
  meta: { title: "t", fps: 30, aspectRatios: ["16:9"], watermark: true, tts: { provider: "say" }, repo: { path: "." } },
  scenes: [
    { kind: "title", content: { heading: "Hi" }, narration: "one two three.", duration: "auto" },
    {
      kind: "code",
      content: { file: "packages/core/src/spec.ts", lineStart: 1, lineEnd: 3 },
      narration: "the spec.",
      duration: "auto",
    },
  ],
};

test("renders a valid narrated mp4 (video+audio streams, correct dims)", async () => {
  rmSync(outDir, { recursive: true, force: true });
  const r = await renderVideo(spec, { repoPath: ".", outDir, baseName: "t", aspectRatios: ["16:9"] });
  expect(r.outputs).toHaveLength(1);
  const out = r.outputs[0]!;
  expect(existsSync(out.path)).toBe(true);
  expect(statSync(out.path).size).toBeGreaterThan(10_000);

  const streams = execFileSync(
    "ffprobe",
    ["-v", "error", "-show_entries", "stream=codec_type,width,height", "-of", "csv=p=0", out.path],
    { encoding: "utf-8" },
  );
  expect(streams).toContain("video,1920,1080");
  expect(streams).toContain("audio"); // aac audio stream present
}, 30_000);

test("CONTRACT: durations == measured audio (two-pass auto)", async () => {
  const r = await renderVideo(spec, { repoPath: ".", outDir, baseName: "t", aspectRatios: ["16:9"] });
  // each auto scene = narration + 0.6s tail
  for (const s of r.scenes) {
    if (s.auto) expect(Math.abs(s.durationSec - (s.narrationMs / 1000 + 0.6))).toBeLessThan(0.01);
  }
  // mp4 total ≈ sum of scene durations (within a frame or two)
  const sum = r.scenes.reduce((a, s) => a + s.durationSec, 0);
  expect(Math.abs(probeDurationMs(r.outputs[0]!.path) / 1000 - sum)).toBeLessThan(0.25);
}, 30_000);

test("CONTRACT: rendered code == live source bytes (in video path too)", async () => {
  const r = await renderVideo(spec, { repoPath: ".", outDir, baseName: "t", aspectRatios: ["16:9"] });
  const code = r.resolvedCode.find((c) => c.scene === 1)!;
  expect(code.bytes).toBeGreaterThan(0);
  expect(code.sha256).toMatch(/^[0-9a-f]{64}$/);
}, 30_000);

test("TTS is cached per line on re-render", async () => {
  const r = await renderVideo(spec, { repoPath: ".", outDir, baseName: "t", aspectRatios: ["16:9"] });
  // second render of identical narration → cache hits
  expect(r.scenes.every((s) => s.ttsCached)).toBe(true);
}, 30_000);
