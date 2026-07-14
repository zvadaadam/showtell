import { expect, test } from "bun:test";
import { execFileSync } from "node:child_process";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, statSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { CodeScene, TitleScene } from "@showtell/core";
import { BundleCompileError, compileBundle, renderBundle } from "../src/index.ts";
import { simpleWebDocument, simpleWebProps } from "../src/simple-web-templates.ts";

const ROOT = join(import.meta.dir, "..", "..", "..");
type CaptionMode = "off" | "sidecar" | "burn-in" | "sidecar-and-burn-in";

const titleScene: TitleScene = {
  kind: "title",
  content: { heading: "Simple by design", subtitle: "One browser runtime" },
  narration: "Showtell lowers simple authoring into browser motion.",
  duration: "auto",
};
const codeScene: CodeScene = {
  kind: "code",
  content: { file: "package.json", lineStart: 1, lineEnd: 12 },
  narration: "Browser code visuals read live repository bytes.",
  duration: "auto",
};

function writeSpec(dir: string, spec: unknown): void {
  writeFileSync(join(dir, "spec.json"), `${JSON.stringify(spec, null, 2)}\n`);
}

function writeWeb(dir: string, name: string, source: string): string {
  mkdirSync(join(dir, "hyperframes"), { recursive: true });
  const src = `hyperframes/${name}.html`;
  writeFileSync(join(dir, src), source);
  return src;
}

function titleVisual(dir: string, name = "title") {
  return {
    kind: "web" as const,
    src: writeWeb(dir, name, simpleWebDocument(titleScene)),
    props: simpleWebProps(titleScene),
    inputs: { reveal: "line:l1" },
  };
}

function webBundle(captions: CaptionMode = "burn-in"): string {
  const dir = mkdtempSync(join(tmpdir(), "showtell-web-bundle-"));
  const title = titleVisual(dir);
  const code = {
    kind: "web" as const,
    src: writeWeb(dir, "code", simpleWebDocument(codeScene)),
    props: simpleWebProps(codeScene),
    inputs: { source: "code", reveal: "line:l1" },
  };
  writeSpec(dir, {
    version: 3,
    meta: { title: "Browser proof", fps: 30, aspectRatios: ["16:9"], repo: { path: ROOT } },
    audio: { tts: { provider: "say" }, captions: { mode: captions, source: "narration" } },
    scenes: [
      {
        id: "intro",
        narration: { lines: [{ id: "l1", text: titleScene.narration }] },
        visual: title,
      },
      {
        id: "source",
        narration: { lines: [{ id: "l1", text: codeScene.narration }] },
        refs: { code: { kind: "code", ...codeScene.content } },
        visual: code,
      },
    ],
  });
  return dir;
}

function probe(path: string): { format: { duration: string }; streams: { codec_type: string; duration?: string }[] } {
  return JSON.parse(
    execFileSync(
      "ffprobe",
      ["-v", "error", "-show_entries", "stream=codec_type,width,height,duration:format=duration", "-of", "json", path],
      { encoding: "utf-8" },
    ),
  );
}

test("compileBundle writes one web program per designed scene with measured timing and live ref hashes", async () => {
  const result = await compileBundle(webBundle());
  expect(existsSync(result.planPath)).toBe(true);
  expect(result.plan.sourceVersion).toBe(3);
  expect(result.plan.meta.durationMs).toBeGreaterThan(0);
  expect(result.plan.meta.resolvedTheme.colors.surface).toBeTruthy();
  expect(result.plan.scenes).toHaveLength(2);
  expect(result.plan.scenes.every((scene) => scene.program.kind === "web")).toBe(true);
  expect(result.plan.scenes[0]!.beats.l1.durationMs).toBeGreaterThan(0);
  expect(result.plan.scenes[0]!.narration.lines[0]!.audioDurationMs).toBeGreaterThan(0);
  expect(result.plan.scenes[1]!.refs.code?.sha256).toMatch(/^[0-9a-f]{64}$/);
}, 30_000);

test("renderBundle renders captioned browser scenes with audio and live ref evidence", async () => {
  const outDir = mkdtempSync(join(tmpdir(), "showtell-web-out-"));
  const result = await renderBundle(webBundle(), { outDir, aspectRatios: ["16:9"], motion: false });
  const output = result.outputs[0]!;
  expect(existsSync(output.path)).toBe(true);
  expect(existsSync(output.captionsPath!)).toBe(true);
  expect(output.captionsBurnedIn).toBe(true);
  expect(statSync(output.path).size).toBeGreaterThan(10_000);
  expect(result.resolvedCode).toHaveLength(1);

  const streams = execFileSync(
    "ffprobe",
    ["-v", "error", "-show_entries", "stream=codec_type,width,height", "-of", "csv=p=0", output.path],
    { encoding: "utf-8" },
  );
  expect(streams).toContain("video,1920,1080");
  expect(streams).toContain("audio");
  const durations = probe(output.path);
  expect(Math.abs(Number(durations.format.duration) * 1000 - result.plan.meta.durationMs)).toBeLessThanOrEqual(34);
}, 180_000);

test("caption sidecars use narration rather than browser visual copy", async () => {
  const dir = webBundle("sidecar");
  const specPath = join(dir, "spec.json");
  const spec = JSON.parse(readFileSync(specPath, "utf8"));
  spec.scenes[0].visual.props.heading = "Not spoken";
  writeSpec(dir, spec);
  const result = await renderBundle(dir, {
    outDir: mkdtempSync(join(tmpdir(), "showtell-sidecar-out-")),
    aspectRatios: ["16:9"],
    motion: false,
  });
  const srt = readFileSync(result.outputs[0]!.captionsPath!, "utf8");
  expect(srt).toContain(titleScene.narration);
  expect(srt).not.toContain("Not spoken");
}, 120_000);

test("compileBundle reports invalid image assets with spec paths", async () => {
  const dir = mkdtempSync(join(tmpdir(), "showtell-invalid-image-"));
  writeFileSync(join(dir, "bad.png"), "not an image");
  writeSpec(dir, {
    version: 3,
    meta: { title: "Invalid image", repo: { path: ROOT }, aspectRatios: ["16:9"] },
    assets: { shot: { type: "image", src: "bad.png" } },
    scenes: [
      {
        id: "intro",
        narration: { lines: [{ id: "l1", text: "This invalid image should fail during compile." }] },
        visual: titleVisual(dir),
      },
    ],
  });

  try {
    await compileBundle(dir);
    throw new Error("compileBundle should have failed");
  } catch (error) {
    expect(error).toBeInstanceOf(BundleCompileError);
    expect((error as BundleCompileError).errors).toContainEqual(
      expect.objectContaining({ code: "BAD_ASSET", path: "assets.shot.src" }),
    );
  }
});

test("compileBundle reports repo-ref failures with spec paths", async () => {
  const dir = mkdtempSync(join(tmpdir(), "showtell-bad-ref-"));
  writeSpec(dir, {
    version: 3,
    meta: { title: "Bad repo ref", repo: { path: ROOT }, aspectRatios: ["16:9"] },
    scenes: [
      {
        id: "intro",
        narration: { lines: [{ id: "l1", text: "This bad line range should fail." }] },
        refs: { source: { kind: "code", file: "package.json", lineStart: 9999, lineEnd: 10000 } },
        visual: titleVisual(dir),
      },
    ],
  });

  try {
    await compileBundle(dir);
    throw new Error("compileBundle should have failed");
  } catch (error) {
    expect(error).toBeInstanceOf(BundleCompileError);
    expect((error as BundleCompileError).errors).toContainEqual(
      expect.objectContaining({ code: "BAD_REPO_REF", path: "scenes.0.refs.source" }),
    );
  }
});

test("renderBundle treats screencap as timed media in the shared plan", async () => {
  const repo = mkdtempSync(join(tmpdir(), "showtell-bundle-screencap-"));
  const captures = join(repo, ".showtell", "captures");
  mkdirSync(captures, { recursive: true });
  execFileSync("ffmpeg", [
    "-y",
    "-loglevel",
    "error",
    "-f",
    "lavfi",
    "-i",
    "testsrc=size=320x180:rate=30:duration=0.5",
    "-pix_fmt",
    "yuv420p",
    join(captures, "demo.mp4"),
  ]);
  const dir = mkdtempSync(join(tmpdir(), "showtell-screencap-bundle-"));
  writeSpec(dir, {
    version: 3,
    meta: { title: "Capture", fps: 30, aspectRatios: ["16:9"], repo: { path: repo } },
    scenes: [
      {
        id: "capture",
        duration: 0.3,
        narration: { lines: [{ id: "l1", text: "Capture." }] },
        visual: { kind: "screencap", sessionRef: "demo", playback: { mode: "realtime" } },
      },
    ],
  });
  const result = await renderBundle(dir, {
    outDir: mkdtempSync(join(tmpdir(), "showtell-screencap-out-")),
    aspectRatios: ["16:9"],
    watermark: false,
  });
  expect(result.plan.scenes[0]!.program.kind).toBe("screencap");
  expect(result.plan.scenes[0]!.durationMs).toBeCloseTo(300, 4);
  expect(existsSync(result.outputs[0]!.path)).toBe(true);
  expect(result.warnings).toHaveLength(0);
}, 60_000);

test("compileBundle rejects a symlinked compiled-plan output", async () => {
  const dir = webBundle();
  const target = join(mkdtempSync(join(tmpdir(), "showtell-plan-target-")), "compiled-plan.json");
  writeFileSync(target, "{}\n");
  symlinkSync(target, join(dir, "compiled-plan.json"));
  try {
    await compileBundle(dir);
    throw new Error("compileBundle should have failed");
  } catch (error) {
    expect(error).toBeInstanceOf(BundleCompileError);
    expect((error as BundleCompileError).errors).toContainEqual(
      expect.objectContaining({ code: "BAD_PLAN_PATH", path: "compiled-plan.json" }),
    );
  }
});

test("compileBundle reports anchor cycles with spec paths", async () => {
  const dir = webBundle();
  const specPath = join(dir, "spec.json");
  const spec = JSON.parse(readFileSync(specPath, "utf8"));
  spec.scenes[0].anchors = [{ id: "loop", at: "anchor:intro/loop" }];
  writeSpec(dir, spec);
  try {
    await compileBundle(dir);
    throw new Error("compileBundle should have failed");
  } catch (error) {
    expect(error).toBeInstanceOf(BundleCompileError);
    expect((error as BundleCompileError).errors).toContainEqual(
      expect.objectContaining({ code: "BAD_COMPILED_TIME_REF", path: "scenes.0.anchors.0.at" }),
    );
  }
});
