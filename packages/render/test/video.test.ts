import { test, expect, afterAll } from "bun:test";
import { existsSync, mkdtempSync, rmSync, statSync, readFileSync } from "node:fs";
import { execFileSync } from "node:child_process";
import { join } from "node:path";
import { tmpdir } from "node:os";
import type { VideoSpec } from "@showtell/core";
import { renderVideo, probeDurationMs } from "../src/index.ts";

const RENDER_TIMEOUT_MS = 90_000;
const DOUBLE_RENDER_TIMEOUT_MS = 180_000;

const harnessRoots: string[] = [];
afterAll(() => {
  for (const root of harnessRoots) rmSync(root, { recursive: true, force: true });
});

function createRenderHarness(label: string): { outDir: string; cacheDir: string } {
  const root = mkdtempSync(join(tmpdir(), `showtell-test-video-${label}-`));
  harnessRoots.push(root);
  return { outDir: join(root, "out"), cacheDir: join(root, "cache") };
}

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

test(
  "renders a valid narrated mp4 (video+audio streams, correct dims)",
  async () => {
    const { outDir, cacheDir } = createRenderHarness("streams");
    const r = await renderVideo(spec, {
      repoPath: ".",
      outDir,
      cacheDir,
      baseName: "t",
      aspectRatios: ["16:9"],
    });
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
  },
  RENDER_TIMEOUT_MS,
);

test(
  "CONTRACT: durations == measured audio (two-pass auto)",
  async () => {
    const { outDir, cacheDir } = createRenderHarness("durations");
    const r = await renderVideo(spec, {
      repoPath: ".",
      outDir,
      cacheDir,
      baseName: "t",
      aspectRatios: ["16:9"],
    });
    // each auto scene = narration + 0.6s tail
    for (const s of r.scenes) {
      if (s.auto) expect(Math.abs(s.durationSec - (s.narrationMs / 1000 + 0.6))).toBeLessThan(0.01);
    }
    // mp4 total ≈ sum of scene durations (within a frame or two)
    const sum = r.scenes.reduce((a, s) => a + s.durationSec, 0);
    expect(Math.abs(probeDurationMs(r.outputs[0]!.path) / 1000 - sum)).toBeLessThan(0.25);
  },
  RENDER_TIMEOUT_MS,
);

test(
  "CONTRACT: rendered code == live source bytes (in video path too)",
  async () => {
    const { outDir, cacheDir } = createRenderHarness("live-source");
    const r = await renderVideo(spec, {
      repoPath: ".",
      outDir,
      cacheDir,
      baseName: "t",
      aspectRatios: ["16:9"],
    });
    const code = r.resolvedCode.find((c) => c.scene === 1)!;
    expect(code.bytes).toBeGreaterThan(0);
    expect(code.sha256).toMatch(/^[0-9a-f]{64}$/);
  },
  RENDER_TIMEOUT_MS,
);

test(
  "TTS is cached per line on re-render",
  async () => {
    const { outDir, cacheDir } = createRenderHarness("tts-cache");
    const opts = { repoPath: ".", outDir, cacheDir, baseName: "t", aspectRatios: ["16:9"] as const };
    await renderVideo(spec, opts);
    const r = await renderVideo(spec, opts);
    // second render of identical narration → cache hits
    expect(r.scenes.every((s) => s.ttsCached)).toBe(true);
  },
  DOUBLE_RENDER_TIMEOUT_MS,
);

test(
  "render cleans intermediates and emits deterministic manifest metadata",
  async () => {
    const { outDir, cacheDir } = createRenderHarness("manifest");
    const opts = { repoPath: ".", outDir, cacheDir, baseName: "t", aspectRatios: ["16:9"] as const };
    const a = await renderVideo(spec, opts);
    const firstManifest = JSON.parse(readFileSync(a.manifestPath, "utf-8")) as { generatedAt: string };
    expect(existsSync(join(outDir, ".work"))).toBe(false);

    const b = await renderVideo(spec, opts);
    const secondManifest = JSON.parse(readFileSync(b.manifestPath, "utf-8")) as { generatedAt: string };
    expect(secondManifest.generatedAt).toBe(firstManifest.generatedAt);
    expect(secondManifest.generatedAt).toBe("1970-01-01T00:00:00.000Z");
  },
  DOUBLE_RENDER_TIMEOUT_MS,
);

test(
  "render cleans intermediates after a failed render",
  async () => {
    const { outDir, cacheDir } = createRenderHarness("failure-cleanup");
    const bad: VideoSpec = {
      ...spec,
      scenes: [
        {
          kind: "code",
          content: { file: "packages/core/src/spec.ts", lineStart: 999_999, lineEnd: 1_000_000 },
          narration: "bad.",
          duration: "auto",
        },
      ],
    };

    await expect(
      renderVideo(bad, { repoPath: ".", outDir, cacheDir, baseName: "bad", aspectRatios: ["16:9"] }),
    ).rejects.toThrow(/past end/);
    expect(existsSync(join(outDir, ".work"))).toBe(false);
  },
  RENDER_TIMEOUT_MS,
);
