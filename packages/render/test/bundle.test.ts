import { test, expect } from "bun:test";
import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import {
  cpSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  statSync,
  symlinkSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { BundleCompileError, compileBundle, renderBundle } from "../src/index.ts";

const ROOT = join(import.meta.dir, "..", "..", "..");

function tempBundle(captionsMode?: "off" | "sidecar" | "burn-in" | "sidecar-and-burn-in"): string {
  const dir = mkdtempSync(join(tmpdir(), "av-bundle-render-"));
  cpSync(join(ROOT, "examples", "bundle-v2"), dir, { recursive: true });
  rmSync(join(dir, "compiled-plan.json"), { force: true });
  const specPath = join(dir, "spec.json");
  const spec = JSON.parse(readFileSync(specPath, "utf-8")) as {
    meta: { repo: { path: string } };
    audio: { captions: { mode: "off" | "sidecar" | "burn-in" | "sidecar-and-burn-in" } };
  };
  spec.meta.repo.path = ROOT;
  if (captionsMode) spec.audio.captions.mode = captionsMode;
  writeFileSync(specPath, JSON.stringify(spec, null, 2) + "\n");
  return dir;
}

function probe(path: string): { format: { duration: string }; streams: { codec_type: string; duration?: string }[] } {
  return JSON.parse(
    execFileSync(
      "ffprobe",
      ["-v", "error", "-show_entries", "stream=codec_type,width,height,duration:format=duration", "-of", "json", path],
      {
        encoding: "utf-8",
      },
    ),
  );
}

function hashFile(path: string): string {
  return createHash("sha256").update(readFileSync(path)).digest("hex");
}

test("compileBundle writes a deterministic plan with measured timing and live ref hashes", async () => {
  const dir = tempBundle();
  const result = await compileBundle(dir);
  expect(existsSync(result.planPath)).toBe(true);
  expect(result.plan.meta.durationMs).toBeGreaterThan(0);
  expect(result.plan.meta.resolvedTheme.colors.surface).toBeTruthy();
  expect(result.plan.meta.resolvedTheme.typography.body).toBe("Inter");
  expect(result.plan.audio.music[0]).toMatchObject({ id: "bed", startMs: 0 });
  expect(result.plan.scenes).toHaveLength(5);
  expect(result.plan.scenes[0]!.beats.l1.durationMs).toBeGreaterThan(0);
  expect(result.plan.scenes[0]!.hyperframe?.inputs.reveal).toMatchObject({
    kind: "range",
    target: "line:l2",
  });
  expect(
    result.plan.scenes.flatMap((scene) => Object.values(scene.refs)).every((ref) => /^[0-9a-f]{64}$/.test(ref.sha256)),
  ).toBe(true);
}, 30_000);

test("renderBundle renders a captioned mp4 from executed hyperframes", async () => {
  const dir = tempBundle();
  const outDir = mkdtempSync(join(tmpdir(), "av-bundle-out-"));
  // Stills: this test asserts captions/streams/refs; the animated path has its own test.
  const result = await renderBundle(dir, { outDir, aspectRatios: ["16:9"], motion: false });
  expect(result.outputs).toHaveLength(1);
  const output = result.outputs[0]!;
  expect(existsSync(output.path)).toBe(true);
  expect(existsSync(output.captionsPath!)).toBe(true);
  expect(output.captionsBurnedIn).toBe(true);
  expect(statSync(output.path).size).toBeGreaterThan(10_000);
  expect(result.resolvedCode).toHaveLength(5);

  const streams = execFileSync(
    "ffprobe",
    ["-v", "error", "-show_entries", "stream=codec_type,width,height", "-of", "csv=p=0", output.path],
    { encoding: "utf-8" },
  );
  expect(streams).toContain("video,1920,1080");
  expect(streams).toContain("audio");
  const durations = probe(output.path);
  expect(Math.abs(Number(durations.format.duration) * 1000 - result.plan.meta.durationMs)).toBeLessThanOrEqual(34);
  expect(
    durations.streams.every((stream) => Math.abs(Number(stream.duration) * 1000 - result.plan.meta.durationMs) <= 34),
  ).toBe(true);
}, 240_000);

test("embedded hyperframes SDK asset matches the real SDK source", () => {
  // The compiled binary ships packages/render/src/hyperframes-sdk.source.txt so
  // bundle render works outside this repo. Regenerate with `bun run gen:schema`.
  const real = readFileSync(join(ROOT, "packages", "hyperframes", "src", "index.ts"), "utf-8");
  const embedded = readFileSync(join(ROOT, "packages", "render", "src", "hyperframes-sdk.source.txt"), "utf-8");
  expect(embedded).toBe(real);
});

test("renderBundle animates hyperframe scenes deterministically", async () => {
  const dir = mkdtempSync(join(tmpdir(), "av-bundle-motion-"));
  mkdirSync(join(dir, "hyperframes"), { recursive: true });
  writeFileSync(
    join(dir, "hyperframes", "journey.tsx"),
    `/* @jsx h */
import { Stage, Stack, CaptionSafeArea, PhaseBanner, TravelPath, h, defineHyperframe, type HyperframeContext, type JsonSchema } from "@showtell/hyperframes";
const propsSchema: JsonSchema = { type: "object", additionalProperties: false, required: ["title"], properties: { title: { type: "string" } } };
const inputs = { flight: { kind: "range" } } as const;
function render(ctx: HyperframeContext<{ title: string }>) {
  return (
    <Stage padding="lg">
      <CaptionSafeArea>
        <Stack direction="vertical" gap="lg" grow>
          <PhaseBanner eyebrow="motion" title={ctx.props.title} />
          <TravelPath from={{ x: 0.8, y: 0.3, label: "PRG" }} to={{ x: 0.15, y: 0.6, label: "SF" }} progress={ctx.range("flight").progress} />
        </Stack>
      </CaptionSafeArea>
    </Stage>
  );
}
export default defineHyperframe({ schemaVersion: 1, propsSchema, inputs, render });
`,
  );
  writeFileSync(
    join(dir, "spec.json"),
    JSON.stringify({
      version: 2,
      meta: { title: "Motion determinism", aspectRatios: ["16:9"], repo: { path: ROOT } },
      assets: {},
      audio: { tts: { provider: "say" }, captions: { mode: "burn-in", source: "narration" } },
      scenes: [
        {
          id: "fly",
          narration: { lines: [{ id: "l1", text: "The plane crosses the frame." }] },
          refs: {},
          visual: {
            kind: "hyperframe",
            src: "hyperframes/journey.tsx",
            props: { title: "Motion check" },
            inputs: { flight: "line:l1" },
          },
        },
      ],
    }),
  );

  // TTS audio (`say`) is not bit-reproducible across runs, so determinism is
  // asserted on the decoded VIDEO stream: same spec, same pixels.
  const videoStreamHash = (path: string): string =>
    execFileSync("ffmpeg", ["-loglevel", "error", "-i", path, "-map", "0:v", "-f", "hash", "-"], {
      encoding: "utf-8",
    }).trim();
  const cacheDir = mkdtempSync(join(tmpdir(), "av-bundle-motion-cache-"));
  const first = await renderBundle(dir, {
    outDir: mkdtempSync(join(tmpdir(), "av-bundle-motion-first-")),
    aspectRatios: ["16:9"],
    cacheDir,
  });
  const output = first.outputs[0]!;
  expect(existsSync(output.path)).toBe(true);
  const durations = probe(output.path);
  expect(Math.abs(Number(durations.format.duration) * 1000 - first.plan.meta.durationMs)).toBeLessThanOrEqual(34);

  const second = await renderBundle(dir, {
    outDir: mkdtempSync(join(tmpdir(), "av-bundle-motion-second-")),
    aspectRatios: ["16:9"],
    cacheDir,
  });
  expect(videoStreamHash(second.outputs[0]!.path)).toBe(videoStreamHash(output.path));
}, 180_000);

test("caption sidecars use spoken narration, not visual prop labels", async () => {
  const dir = mkdtempSync(join(tmpdir(), "av-bundle-caption-text-"));
  mkdirSync(dir, { recursive: true });
  writeFileSync(
    join(dir, "spec.json"),
    JSON.stringify({
      version: 2,
      meta: { title: "Caption text", repo: { path: ROOT }, aspectRatios: ["16:9"] },
      audio: { captions: { mode: "sidecar" } },
      scenes: [
        {
          id: "intro",
          narration: {
            lines: [
              {
                id: "l1",
                text: "This is the exact spoken narration that must appear in captions.",
              },
            ],
          },
          visual: { kind: "builtin", name: "title", props: { title: "Caption text", label: "Short visual label." } },
        },
      ],
    }),
  );

  const outDir = mkdtempSync(join(tmpdir(), "av-bundle-caption-text-out-"));
  const result = await renderBundle(dir, { outDir, aspectRatios: ["16:9"] });
  const srt = readFileSync(result.outputs[0]!.captionsPath!, "utf-8");
  expect(srt).toContain("This is the exact spoken narration that must appear in captions.");
  expect(srt).not.toContain("Short visual label.");
}, 60_000);

test("renderBundle can render a copied hyperframe starter template", async () => {
  const dir = mkdtempSync(join(tmpdir(), "av-bundle-template-"));
  mkdirSync(join(dir, "hyperframes"), { recursive: true });
  cpSync(
    join(ROOT, "packages", "hyperframes", "templates", "code-kinetic-caption.tsx"),
    join(dir, "hyperframes", "code-kinetic-caption.tsx"),
  );
  writeFileSync(
    join(dir, "spec.json"),
    JSON.stringify({
      version: 2,
      meta: { title: "Starter template render", repo: { path: ROOT }, aspectRatios: ["16:9"] },
      scenes: [
        {
          id: "intro",
          narration: {
            lines: [
              { id: "l1", text: "This starter template renders from a copied hyperframe file." },
              { id: "l2", text: "The second beat shows live repo code through the reusable code primitive." },
            ],
          },
          refs: {
            source: {
              kind: "code",
              file: "packages/hyperframes/src/index.ts",
              lineStart: 1,
              lineEnd: 40,
              focus: [19],
            },
          },
          visual: {
            kind: "hyperframe",
            src: "hyperframes/code-kinetic-caption.tsx",
            inputs: { source: "source" },
            props: { title: "Reusable starter", emphasis: ["starter", "hyperframe"] },
          },
        },
      ],
    }),
  );

  const outDir = mkdtempSync(join(tmpdir(), "av-bundle-template-out-"));
  const result = await renderBundle(dir, { outDir, aspectRatios: ["16:9"] });
  expect(result.outputs).toHaveLength(1);
  expect(existsSync(result.outputs[0]!.path)).toBe(true);
  expect(result.resolvedCode).toHaveLength(1);
}, 60_000);

test("changing only the hyperframe render body changes rendered frames", async () => {
  const dir = mkdtempSync(join(tmpdir(), "av-bundle-real-hyperframe-"));
  mkdirSync(join(dir, "hyperframes"), { recursive: true });
  const hyperframePath = join(dir, "hyperframes", "body.tsx");
  const source = (label: string) =>
    [
      "/* @jsx h */",
      'import { type HyperframeContext, type JsonSchema, Stage, Text, h, defineHyperframe } from "@showtell/hyperframes";',
      "interface Props { title: string }",
      'const propsSchema: JsonSchema = { type: "object", additionalProperties: false, required: ["title"], properties: { title: { type: "string" } } };',
      "const inputs = {};",
      "function render(ctx: HyperframeContext<Props>) {",
      `  return <Stage tone="dark" padding="xl"><Text variant="title">${label}: {ctx.props.title}</Text></Stage>;`,
      "}",
      "export default defineHyperframe({ schemaVersion: 1, propsSchema, inputs, render });",
    ].join("\n");
  writeFileSync(hyperframePath, source("FIRST BODY"));
  writeFileSync(
    join(dir, "spec.json"),
    JSON.stringify({
      version: 2,
      meta: { title: "Real hyperframe body", repo: { path: ROOT }, aspectRatios: ["16:9"] },
      audio: { captions: { mode: "off" } },
      scenes: [
        {
          id: "intro",
          narration: { lines: [{ id: "l1", text: "The pixels must come from the hyperframe render body." }] },
          visual: {
            kind: "hyperframe",
            src: "hyperframes/body.tsx",
            props: { title: "same spec props" },
          },
        },
      ],
    }),
  );

  const first = await renderBundle(dir, {
    outDir: mkdtempSync(join(tmpdir(), "av-bundle-real-hyperframe-first-")),
    aspectRatios: ["16:9"],
  });
  const firstThumb = hashFile(join(first.outDir, "thumb-000.png"));
  const firstSource = first.plan.scenes[0]!.hyperframe!.sourceSha256;

  writeFileSync(hyperframePath, source("SECOND BODY"));
  const second = await renderBundle(dir, {
    outDir: mkdtempSync(join(tmpdir(), "av-bundle-real-hyperframe-second-")),
    aspectRatios: ["16:9"],
  });

  expect(second.plan.scenes[0]!.hyperframe!.sourceSha256).not.toBe(firstSource);
  expect(hashFile(join(second.outDir, "thumb-000.png"))).not.toBe(firstThumb);
}, 90_000);

test("renderBundle reports every repo ref drawn in a hyperframe frame", async () => {
  const repo = mkdtempSync(join(tmpdir(), "av-bundle-multi-ref-repo-"));
  execFileSync("git", ["-C", repo, "init", "-q"]);
  execFileSync("git", ["-C", repo, "config", "user.email", "t@t"]);
  execFileSync("git", ["-C", repo, "config", "user.name", "t"]);
  writeFileSync(join(repo, "f.ts"), "export const value = 1;\n");
  execFileSync("git", ["-C", repo, "add", "."]);
  execFileSync("git", ["-C", repo, "commit", "-q", "-m", "one"]);
  writeFileSync(join(repo, "f.ts"), "export const value = 2;\nexport const next = 3;\n");
  execFileSync("git", ["-C", repo, "add", "."]);
  execFileSync("git", ["-C", repo, "commit", "-q", "-m", "two"]);

  const dir = mkdtempSync(join(tmpdir(), "av-bundle-multi-ref-"));
  mkdirSync(join(dir, "hyperframes"), { recursive: true });
  writeFileSync(
    join(dir, "hyperframes", "multi.tsx"),
    [
      "/* @jsx h */",
      'import { CodeRef, DiffRef, Grid, Stage, h, defineHyperframe } from "@showtell/hyperframes";',
      'const propsSchema = { type: "object", properties: {} };',
      'const inputs = { code: { kind: "repo", refKind: "code" }, diff: { kind: "repo", refKind: "diff" } };',
      "function render(ctx) {",
      '  return <Stage tone="dark" padding="lg"><Grid columns={2} gap="md"><CodeRef source={ctx.repo("code")} /><DiffRef source={ctx.repo("diff")} /></Grid></Stage>;',
      "}",
      "export default defineHyperframe({ schemaVersion: 1, propsSchema, inputs, render });",
    ].join("\n"),
  );
  writeFileSync(
    join(dir, "spec.json"),
    JSON.stringify({
      version: 2,
      meta: { title: "Multi ref proof", repo: { path: repo }, aspectRatios: ["16:9"] },
      audio: { captions: { mode: "off" } },
      scenes: [
        {
          id: "proof",
          narration: { lines: [{ id: "l1", text: "This frame draws live code and a live diff." }] },
          refs: {
            code: { kind: "code", file: "f.ts" },
            diff: { kind: "diff", file: "f.ts", ref: "HEAD~1..HEAD" },
          },
          visual: {
            kind: "hyperframe",
            src: "hyperframes/multi.tsx",
            inputs: { code: "code", diff: "diff" },
          },
        },
      ],
    }),
  );

  const result = await renderBundle(dir, {
    outDir: mkdtempSync(join(tmpdir(), "av-bundle-multi-ref-out-")),
    aspectRatios: ["16:9"],
  });
  expect(result.resolvedCode).toHaveLength(2);
  expect(new Set(result.resolvedCode.map((ref) => ref.sha256)).size).toBe(2);
}, 60_000);

test("renderBundle renders component-kit hyperframes without media primitives", async () => {
  const dir = mkdtempSync(join(tmpdir(), "av-bundle-component-kit-"));
  mkdirSync(join(dir, "hyperframes"), { recursive: true });
  const source = [
    "/* @jsx h */",
    'import { CaptionSafeArea, DecisionGrid, PhaseBanner, SignalWall, Stack, Stage, StatusRail, h, defineHyperframe } from "@showtell/hyperframes";',
    'const propsSchema = { type: "object", additionalProperties: false, required: ["title", "steps", "options", "signals"], properties: { title: { type: "string" }, steps: { type: "array", items: { type: "string" } }, options: { type: "array", items: { type: "string" } }, signals: { type: "array", items: { type: "string" } } } };',
    "const inputs = {};",
    "function render(ctx) {",
    "  const active = ctx.scene.lineIndex;",
    "  const body = active === 0",
    "    ? <DecisionGrid options={ctx.props.options} activeIndex={1} />",
    "    : active === 1",
    "      ? <SignalWall items={ctx.props.signals} activeIndex={2} />",
    "      : <StatusRail steps={ctx.props.steps} activeIndex={ctx.props.steps.length - 1} progress={1} />;",
    '  return <Stage tone="dark" padding="lg"><CaptionSafeArea><Stack direction="vertical" gap="lg" grow><PhaseBanner eyebrow="component kit" title={ctx.props.title} phase={active} />{body}</Stack></CaptionSafeArea></Stage>;',
    "}",
    "export default defineHyperframe({ schemaVersion: 1, propsSchema, inputs, render });",
  ].join("\n");
  expect(source).not.toMatch(/\b(CodeRef|DiffRef|Chart|ImageAsset)\b/);
  writeFileSync(join(dir, "hyperframes", "kit.tsx"), source);
  writeFileSync(
    join(dir, "spec.json"),
    JSON.stringify({
      version: 2,
      meta: { title: "Component kit render", repo: { path: ROOT }, aspectRatios: ["16:9"] },
      audio: { captions: { mode: "off" } },
      scenes: [
        {
          id: "kit",
          narration: {
            lines: [
              { id: "l1", text: "Reusable components turn templates into a kit." },
              { id: "l2", text: "The agent can switch the visual body by narration line." },
              { id: "l3", text: "The renderer still owns timing and pixels." },
            ],
          },
          visual: {
            kind: "hyperframe",
            src: "hyperframes/kit.tsx",
            props: {
              title: "Components, not copy-only templates",
              steps: ["contract", "component", "line state", "mp4"],
              options: ["copy a file", "reuse a component", "hardcode a scene"],
              signals: ["host atoms", "story components", "media primitives", "templates as examples"],
            },
          },
        },
      ],
    }),
  );

  const result = await renderBundle(dir, {
    outDir: mkdtempSync(join(tmpdir(), "av-bundle-component-kit-out-")),
    aspectRatios: ["16:9"],
  });
  expect(existsSync(result.outputs[0]!.path)).toBe(true);
  expect(result.resolvedCode).toHaveLength(0);
}, 60_000);

test("compileBundle reports invalid image assets with spec paths", async () => {
  const dir = mkdtempSync(join(tmpdir(), "av-bundle-invalid-image-"));
  mkdirSync(join(dir, "assets"), { recursive: true });
  writeFileSync(join(dir, "assets", "bad.png"), "not an image");
  writeFileSync(
    join(dir, "spec.json"),
    JSON.stringify({
      version: 2,
      meta: { title: "Invalid image", repo: { path: ROOT }, aspectRatios: ["16:9"] },
      assets: { shot: { type: "image", src: "assets/bad.png" } },
      scenes: [
        {
          id: "intro",
          narration: { lines: [{ id: "l1", text: "This invalid image should fail during compile." }] },
          visual: { kind: "builtin", name: "title", props: { title: "Invalid image" } },
        },
      ],
    }),
  );

  try {
    await compileBundle(dir);
    throw new Error("compileBundle should have failed");
  } catch (e) {
    expect(e).toBeInstanceOf(BundleCompileError);
    expect((e as BundleCompileError).errors).toContainEqual(
      expect.objectContaining({
        code: "BAD_ASSET",
        path: "assets.shot.src",
      }),
    );
  }
});

test("compileBundle reports repo-ref compile failures with spec paths", async () => {
  const dir = mkdtempSync(join(tmpdir(), "av-bundle-bad-repo-ref-"));
  writeFileSync(
    join(dir, "spec.json"),
    JSON.stringify({
      version: 2,
      meta: { title: "Bad repo ref", repo: { path: ROOT }, aspectRatios: ["16:9"] },
      scenes: [
        {
          id: "intro",
          narration: { lines: [{ id: "l1", text: "This bad repo range should fail during compile." }] },
          refs: {
            source: {
              kind: "code",
              file: "package.json",
              lineStart: 9999,
              lineEnd: 10000,
            },
          },
          visual: { kind: "builtin", name: "title", props: { title: "Bad repo ref" } },
        },
      ],
    }),
  );

  try {
    await compileBundle(dir);
    throw new Error("compileBundle should have failed");
  } catch (e) {
    expect(e).toBeInstanceOf(BundleCompileError);
    expect((e as BundleCompileError).errors).toContainEqual(
      expect.objectContaining({
        code: "BAD_REPO_REF",
        path: "scenes.0.refs.source",
      }),
    );
  }
});

test("renderBundle can render copied diff and image starter templates", async () => {
  const repo = mkdtempSync(join(tmpdir(), "av-bundle-template-repo-"));
  execFileSync("git", ["-C", repo, "init", "-q"]);
  execFileSync("git", ["-C", repo, "config", "user.email", "t@t"]);
  execFileSync("git", ["-C", repo, "config", "user.name", "t"]);
  writeFileSync(join(repo, "f.ts"), "export const value = 1;\n");
  execFileSync("git", ["-C", repo, "add", "."]);
  execFileSync("git", ["-C", repo, "commit", "-q", "-m", "one"]);
  writeFileSync(join(repo, "f.ts"), "export const value = 2;\nexport const next = 3;\n");
  execFileSync("git", ["-C", repo, "add", "."]);
  execFileSync("git", ["-C", repo, "commit", "-q", "-m", "two"]);

  const diffDir = mkdtempSync(join(tmpdir(), "av-bundle-diff-template-"));
  mkdirSync(join(diffDir, "hyperframes"), { recursive: true });
  cpSync(
    join(ROOT, "packages", "hyperframes", "templates", "diff-review.tsx"),
    join(diffDir, "hyperframes", "diff.tsx"),
  );
  writeFileSync(
    join(diffDir, "spec.json"),
    JSON.stringify({
      version: 2,
      meta: { title: "Diff template render", repo: { path: repo }, aspectRatios: ["16:9"] },
      scenes: [
        {
          id: "diff",
          narration: { lines: [{ id: "l1", text: "This copied starter shows the changed lines." }] },
          refs: { source: { kind: "diff", file: "f.ts", ref: "HEAD~1..HEAD" } },
          visual: {
            kind: "hyperframe",
            src: "hyperframes/diff.tsx",
            inputs: { source: "source" },
            props: { title: "Changed value" },
          },
        },
      ],
    }),
  );
  const diffResult = await renderBundle(diffDir, {
    outDir: mkdtempSync(join(tmpdir(), "av-bundle-diff-template-out-")),
    aspectRatios: ["16:9"],
  });
  expect(existsSync(diffResult.outputs[0]!.path)).toBe(true);
  expect(diffResult.resolvedCode).toHaveLength(1);

  const imageDir = mkdtempSync(join(tmpdir(), "av-bundle-image-template-"));
  mkdirSync(join(imageDir, "hyperframes"), { recursive: true });
  mkdirSync(join(imageDir, "assets", "images"), { recursive: true });
  cpSync(
    join(ROOT, "packages", "hyperframes", "templates", "image-callout.tsx"),
    join(imageDir, "hyperframes", "image.tsx"),
  );
  writeFileSync(
    join(imageDir, "assets", "images", "pixel.png"),
    Buffer.from(
      "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mO89+5dPQAJ1ANe9Xxa5QAAAABJRU5ErkJggg==",
      "base64",
    ),
  );
  writeFileSync(
    join(imageDir, "spec.json"),
    JSON.stringify({
      version: 2,
      meta: { title: "Image template render", repo: { path: ROOT }, aspectRatios: ["16:9"] },
      assets: { shot: { type: "image", src: "assets/images/pixel.png" } },
      scenes: [
        {
          id: "image",
          narration: { lines: [{ id: "l1", text: "This copied starter shows one visual result." }] },
          visual: {
            kind: "hyperframe",
            src: "hyperframes/image.tsx",
            inputs: { image: "shot" },
            props: { title: "Visual result" },
          },
        },
      ],
    }),
  );
  const imageResult = await renderBundle(imageDir, {
    outDir: mkdtempSync(join(tmpdir(), "av-bundle-image-template-out-")),
    aspectRatios: ["16:9"],
  });
  expect(existsSync(imageResult.outputs[0]!.path)).toBe(true);
  expect(imageResult.plan.assets.shot).toMatchObject({ width: 1, height: 1 });
}, 90_000);

test("renderBundle normalizes duration for non-burn-in caption modes", async () => {
  for (const mode of ["off", "sidecar"] as const) {
    const dir = tempBundle(mode);
    const outDir = mkdtempSync(join(tmpdir(), `av-bundle-${mode}-`));
    const result = await renderBundle(dir, { outDir, aspectRatios: ["16:9"], motion: false });
    const output = result.outputs[0]!;
    expect(output.captionsBurnedIn).toBe(false);
    expect(Boolean(output.captionsPath)).toBe(mode === "sidecar");
    const durations = probe(output.path);
    expect(Math.abs(Number(durations.format.duration) * 1000 - result.plan.meta.durationMs)).toBeLessThanOrEqual(34);
    expect(
      durations.streams.every((stream) => Math.abs(Number(stream.duration) * 1000 - result.plan.meta.durationMs) <= 34),
    ).toBe(true);
  }
}, 360_000);

test("renderBundle returns render warnings with scene and line paths", async () => {
  const dir = mkdtempSync(join(tmpdir(), "av-bundle-warning-"));
  mkdirSync(dir, { recursive: true });
  writeFileSync(
    join(dir, "spec.json"),
    JSON.stringify({
      version: 2,
      meta: { title: "Warning bundle", repo: { path: ROOT }, aspectRatios: ["16:9"] },
      scenes: [
        {
          id: "chart",
          narration: { lines: [{ id: "l1", text: "This chart has no numeric data." }] },
          visual: {
            kind: "builtin",
            name: "chart",
            props: { title: "No numeric data", data: [{ label: "only a label" }] },
          },
        },
      ],
    }),
  );

  const outDir = mkdtempSync(join(tmpdir(), "av-bundle-warning-out-"));
  const result = await renderBundle(dir, { outDir, aspectRatios: ["16:9"] });
  expect(result.warnings).toContainEqual(
    expect.objectContaining({
      code: "RENDER_WARNING",
      path: "scenes.0.narration.lines.0",
    }),
  );
}, 60_000);

test("renderBundle rejects unknown ctx.range names", async () => {
  const dir = mkdtempSync(join(tmpdir(), "av-bundle-unknown-range-"));
  mkdirSync(join(dir, "hyperframes"), { recursive: true });
  writeFileSync(
    join(dir, "hyperframes", "bad-range.tsx"),
    [
      "/* @jsx h */",
      'import { Stage, Text, h, defineHyperframe } from "@showtell/hyperframes";',
      'const propsSchema = { type: "object", properties: {} };',
      "const inputs = {};",
      "function render(ctx) {",
      '  const reveal = ctx.range("missing");',
      '  return <Stage padding="lg"><Text variant="title">range {reveal.progress}</Text></Stage>;',
      "}",
      "export default defineHyperframe({ schemaVersion: 1, propsSchema, inputs, render });",
    ].join("\n"),
  );
  writeFileSync(
    join(dir, "spec.json"),
    JSON.stringify({
      version: 2,
      meta: { title: "Unknown range", repo: { path: ROOT }, aspectRatios: ["16:9"] },
      audio: { captions: { mode: "off" } },
      scenes: [
        {
          id: "intro",
          narration: { lines: [{ id: "l1", text: "Unknown ranges should fail instead of falling back." }] },
          visual: { kind: "hyperframe", src: "hyperframes/bad-range.tsx" },
        },
      ],
    }),
  );

  try {
    await renderBundle(dir, {
      outDir: mkdtempSync(join(tmpdir(), "av-bundle-unknown-range-out-")),
      aspectRatios: ["16:9"],
    });
    throw new Error("renderBundle should have failed");
  } catch (e) {
    expect((e as Error).message).toContain('Unknown range "missing"');
  }
}, 60_000);

test("compileBundle reports backward hyperframe input ranges with spec paths", async () => {
  const dir = mkdtempSync(join(tmpdir(), "av-bundle-bad-range-"));
  mkdirSync(join(dir, "hyperframes"), { recursive: true });
  writeFileSync(
    join(dir, "hyperframes", "range.tsx"),
    [
      'const propsSchema = { type: "object", properties: { title: { type: "string" } } };',
      'const inputs = { reveal: { kind: "range" } };',
      "function render() { return null; }",
      "export default { schemaVersion: 1, propsSchema, inputs, render };",
    ].join("\n"),
  );
  writeFileSync(
    join(dir, "spec.json"),
    JSON.stringify({
      version: 2,
      meta: { title: "Bad compiled range", repo: { path: ROOT }, aspectRatios: ["16:9"] },
      scenes: [
        {
          id: "range",
          narration: {
            lines: [
              { id: "l1", text: "First line." },
              { id: "l2", text: "Second line." },
            ],
          },
          visual: {
            kind: "hyperframe",
            src: "hyperframes/range.tsx",
            inputs: { reveal: { from: "line:l2@end", to: "line:l1@start" } },
            props: { title: "Range" },
          },
        },
      ],
    }),
  );

  try {
    await compileBundle(dir);
    throw new Error("compileBundle should have failed");
  } catch (e) {
    expect(e).toBeInstanceOf(BundleCompileError);
    expect((e as BundleCompileError).errors).toContainEqual(
      expect.objectContaining({
        code: "BAD_COMPILED_TIME_RANGE",
        path: "scenes.0.visual.inputs.reveal",
      }),
    );
  }
}, 30_000);

test("compileBundle rejects symlinked compiled plan output", async () => {
  const dir = mkdtempSync(join(tmpdir(), "av-bundle-plan-symlink-"));
  mkdirSync(dir, { recursive: true });
  const targetDir = mkdtempSync(join(tmpdir(), "av-bundle-plan-target-"));
  const target = join(targetDir, "compiled-plan.json");
  writeFileSync(target, "{}\n");
  symlinkSync(target, join(dir, "compiled-plan.json"));
  writeFileSync(
    join(dir, "spec.json"),
    JSON.stringify({
      version: 2,
      meta: { title: "Plan symlink", repo: { path: ROOT }, aspectRatios: ["16:9"] },
      scenes: [
        {
          id: "intro",
          narration: { lines: [{ id: "l1", text: "A plan symlink must not be overwritten." }] },
          visual: { kind: "builtin", name: "title", props: { title: "Plan symlink" } },
        },
      ],
    }),
  );

  try {
    await compileBundle(dir);
    throw new Error("compileBundle should have failed");
  } catch (e) {
    expect(e).toBeInstanceOf(BundleCompileError);
    expect((e as BundleCompileError).errors).toContainEqual(
      expect.objectContaining({
        code: "BAD_PLAN_PATH",
        path: "compiled-plan.json",
      }),
    );
  }
});

test("compileBundle reports anchor cycles with spec paths", async () => {
  const dir = mkdtempSync(join(tmpdir(), "av-bundle-anchor-cycle-"));
  mkdirSync(dir, { recursive: true });
  writeFileSync(
    join(dir, "spec.json"),
    JSON.stringify({
      version: 2,
      meta: { title: "Anchor cycle", repo: { path: ROOT }, aspectRatios: ["16:9"] },
      scenes: [
        {
          id: "intro",
          narration: { lines: [{ id: "l1", text: "An anchor cycle should fail before rendering." }] },
          anchors: [{ id: "loop", at: "anchor:intro/loop" }],
          visual: { kind: "builtin", name: "title", props: { title: "Anchor cycle" } },
        },
      ],
    }),
  );

  try {
    await compileBundle(dir);
    throw new Error("compileBundle should have failed");
  } catch (e) {
    expect(e).toBeInstanceOf(BundleCompileError);
    expect((e as BundleCompileError).errors).toContainEqual(
      expect.objectContaining({
        code: "BAD_COMPILED_TIME_REF",
        path: "scenes.0.anchors.0.at",
      }),
    );
  }
});
