import { expect, test } from "bun:test";
import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { ChartScene, TitleScene } from "@showtell/core";
import { BundleReviewError, reviewBundle } from "../src/index.ts";
import { simpleWebDocument, simpleWebProps } from "../src/simple-web-templates.ts";

const ROOT = join(import.meta.dir, "..", "..", "..");

function seedSay(cacheDir: string, texts: string[]): void {
  const ttsDir = join(cacheDir, "tts");
  mkdirSync(ttsDir, { recursive: true });
  for (const text of texts) {
    const key = createHash("sha256")
      .update(JSON.stringify({ provider: "say", voice: "", model: "", text }))
      .digest("hex")
      .slice(0, 32);
    execFileSync("ffmpeg", [
      "-y",
      "-loglevel",
      "error",
      "-f",
      "lavfi",
      "-i",
      "anullsrc=r=44100:cl=mono",
      "-t",
      "0.6",
      join(ttsDir, `say-${key}.wav`),
    ]);
  }
}

function reviewFixture(): { dir: string; cacheDir: string } {
  const dir = mkdtempSync(join(tmpdir(), "showtell-review-"));
  const cacheDir = join(dir, "cache");
  const texts = ["This line is sampled at exact video timestamps.", "The scene filter selects stable ids."];
  seedSay(cacheDir, texts);
  const chart: ChartScene = {
    kind: "chart",
    content: {
      chartType: "bar",
      title: "Coverage",
      data: [
        { label: "before", value: 1 },
        { label: "after", value: 3 },
      ],
    },
    narration: texts[0]!,
    duration: "auto",
  };
  const title: TitleScene = {
    kind: "title",
    content: { heading: "Second scene" },
    narration: texts[1]!,
    duration: "auto",
  };
  mkdirSync(join(dir, "hyperframes"), { recursive: true });
  mkdirSync(join(dir, "assets"), { recursive: true });
  writeFileSync(join(dir, "hyperframes", "chart.html"), simpleWebDocument(chart));
  writeFileSync(join(dir, "hyperframes", "title.html"), simpleWebDocument(title));
  writeFileSync(join(dir, "assets", "metrics.json"), `${JSON.stringify(chart.content.data)}\n`);
  writeFileSync(
    join(dir, "spec.json"),
    JSON.stringify(
      {
        version: 3,
        meta: { title: "Review exact frames", fps: 30, repo: { path: ROOT }, aspectRatios: ["16:9"] },
        assets: { metrics: { type: "data", src: "assets/metrics.json" } },
        audio: { tts: { provider: "say" }, captions: { mode: "off" } },
        scenes: [
          {
            id: "chart",
            narration: { lines: [{ id: "l1", text: texts[0] }] },
            visual: {
              kind: "web",
              src: "hyperframes/chart.html",
              props: simpleWebProps(chart),
              inputs: { data: "metrics", reveal: "line:l1" },
            },
          },
          {
            id: "second",
            narration: { lines: [{ id: "l1", text: texts[1] }] },
            visual: {
              kind: "web",
              src: "hyperframes/title.html",
              props: simpleWebProps(title),
              inputs: { reveal: "line:l1" },
            },
          },
        ],
      },
      null,
      2,
    ) + "\n",
  );
  return { dir, cacheDir };
}

test("reviewBundle writes a gallery and exact monotonic frame samples", async () => {
  const fixture = reviewFixture();
  const result = await reviewBundle(fixture.dir, {
    outDir: mkdtempSync(join(tmpdir(), "showtell-review-out-")),
    aspectRatios: ["16:9"],
    cacheDir: fixture.cacheDir,
    samplesPerLine: 5,
  });
  expect(result).toMatchObject({ ok: true, stage: "bundle-review", samplesPerLine: 5 });
  expect(existsSync(result.manifestPath)).toBe(true);
  expect(existsSync(result.indexPath)).toBe(true);
  const line = result.scenes[0]!.lines[0]!;
  expect(line.samples).toHaveLength(5);
  expect(line.samples.every((sample) => existsSync(sample.path) && /^[0-9a-f]{64}$/.test(sample.sha256))).toBe(true);
  const times = line.samples.map((sample) => sample.timeMs);
  expect(times).toEqual([...times].sort((a, b) => a - b));
  for (const sample of line.samples) {
    const localFrame = ((sample.timeMs - line.startMs) * 30) / 1000 - 0.5;
    expect(localFrame).toBeCloseTo(Math.round(localFrame), 8);
    expect(sample.frame).toBe(Math.round((sample.timeMs * 30) / 1000));
  }
  const manifest = JSON.parse(readFileSync(result.manifestPath, "utf8"));
  expect(manifest.scenes[0].lines[0].samples).toHaveLength(5);
  expect(manifest.advisory.metrics).toEqual({ totalSamples: 10, staticVisualLines: 0 });
}, 60_000);

test("reviewBundle filters scenes and reports valid ids for an unknown filter", async () => {
  const fixture = reviewFixture();
  const result = await reviewBundle(fixture.dir, {
    outDir: mkdtempSync(join(tmpdir(), "showtell-review-filter-")),
    aspectRatios: ["16:9"],
    cacheDir: fixture.cacheDir,
    sceneId: "second",
    samplesPerLine: 2,
  });
  expect(result.scenes.map((scene) => scene.id)).toEqual(["second"]);
  await expect(reviewBundle(fixture.dir, { cacheDir: fixture.cacheDir, sceneId: "missing" })).rejects.toMatchObject({
    constructor: BundleReviewError,
    hint: expect.stringContaining("chart, second"),
  });
}, 60_000);

test("reviewBundle validates sample counts before touching the bundle", async () => {
  await expect(reviewBundle("missing", { samplesPerLine: 1 })).rejects.toMatchObject({
    constructor: BundleReviewError,
    hint: "Pass --samples as an integer between 2 and 60.",
  });
  await expect(reviewBundle("missing", { samplesPerLine: 61 })).rejects.toMatchObject({
    constructor: BundleReviewError,
    extra: { samplesPerLine: 61, maxSamplesPerLine: 60 },
  });
});

test("reviewBundle repeats identical exact timestamps and pixels", async () => {
  const fixture = reviewFixture();
  const outDir = mkdtempSync(join(tmpdir(), "showtell-review-repeat-"));
  const options = { outDir, aspectRatios: ["16:9"] as const, cacheDir: fixture.cacheDir, samplesPerLine: 3 };
  const first = await reviewBundle(fixture.dir, options);
  const second = await reviewBundle(fixture.dir, options);
  const compact = (result: typeof first) =>
    result.scenes.flatMap((scene) =>
      scene.lines.flatMap((line) => line.samples.map((sample) => [sample.fraction, sample.timeMs, sample.sha256])),
    );
  expect(compact(second)).toEqual(compact(first));
}, 60_000);
