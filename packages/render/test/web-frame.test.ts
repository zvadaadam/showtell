import { expect, test } from "bun:test";
import { createHash } from "node:crypto";
import { execFileSync } from "node:child_process";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, statSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { chromium } from "playwright-core";
import { compileBundle, exactBundleFrameAt, lineSampleTimeMs, renderBundle } from "../src/bundle.ts";
import { createBundleFrameProducer } from "../src/frame-producer.ts";
import { reviewBundle } from "../src/review.ts";
import { webRuntimeIdentity } from "../src/web-authoring.ts";
import { assertPinnedBrowserVersion, decorateHtml, WebFrameRenderer } from "../src/web-frame.ts";

const browserAvailable = existsSync(chromium.executablePath());
const tinyPng = Buffer.from(
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mO89+5dPQAJ1ANe9Xxa5QAAAABJRU5ErkJggg==",
  "base64",
);

test("pinned browser identity rejects a mismatched executable", () => {
  expect(() => assertPinnedBrowserVersion("149.0.7827.55")).not.toThrow();
  expect(() => assertPinnedBrowserVersion("HeadlessChrome/149.0.7827.0")).not.toThrow();
  expect(() => assertPinnedBrowserVersion("HeadlessChrome/149.0.7828.0")).toThrow("expected 149.0.7827.x");
  expect(() => assertPinnedBrowserVersion("150.0.7827.55")).toThrow("expected 149.0.7827.x");
});

test("web runtime identity stays aligned with pinned render dependencies", () => {
  const manifest = JSON.parse(readFileSync(join(import.meta.dir, "..", "package.json"), "utf-8")) as {
    dependencies: Record<string, string>;
  };
  expect(webRuntimeIdentity.playwright).toBe(manifest.dependencies.playwright);
  expect(webRuntimeIdentity.gsap).toBe(manifest.dependencies.gsap);

  const fontPackages = new Map([
    ["Inter", "@fontsource/inter"],
    ["JetBrains Mono", "@fontsource/jetbrains-mono"],
    ["League Gothic", "@fontsource/league-gothic"],
    ["Space Mono", "@fontsource/space-mono"],
  ]);
  for (const font of webRuntimeIdentity.fonts) {
    expect(font.version).toBe(manifest.dependencies[fontPackages.get(font.family)!]);
  }
});

function seedSay(cacheDir: string, text: string): void {
  const key = createHash("sha256")
    .update(JSON.stringify({ provider: "say", voice: "", model: "", text }))
    .digest("hex")
    .slice(0, 32);
  const dir = join(cacheDir, "tts");
  mkdirSync(dir, { recursive: true });
  execFileSync("ffmpeg", [
    "-y",
    "-loglevel",
    "error",
    "-f",
    "lavfi",
    "-i",
    "anullsrc=r=44100:cl=mono",
    "-t",
    "0.8",
    join(dir, `say-${key}.wav`),
  ]);
}

function webFixture(extraBody = ""): { bundleDir: string; cacheDir: string; repoDir: string } {
  const root = mkdtempSync(join(tmpdir(), "showtell-web-frame-"));
  const repoDir = join(root, "repo");
  const bundleDir = join(root, "video.showtell");
  const cacheDir = join(root, "cache");
  mkdirSync(join(bundleDir, "hyperframes"), { recursive: true });
  mkdirSync(repoDir, { recursive: true });
  writeFileSync(
    join(repoDir, "motion.ts"),
    "export function progress(time: number) {\n  return Math.min(1, time / 1000);\n}\n",
  );
  const narration = "A deterministic browser frame follows the measured narration clock.";
  seedSay(cacheDir, narration);
  writeFileSync(
    join(bundleDir, "hyperframes", "motion.html"),
    `<!doctype html>
<html><head><meta charset="utf-8">
<script type="application/showtell+json">{"schemaVersion":3,"inputs":{"source":{"kind":"repo","refKind":"code"},"reveal":{"kind":"range"}}}</script>
<style>
body{background:#090b16;color:#f7f8ff;font-family:var(--st-font-body);display:grid;place-items:center}
.world{width:86%;height:76%;position:relative;border:1px solid #29304a;border-radius:32px;background:radial-gradient(circle at 20% 20%,#242d64 0,transparent 42%),#0d1020;overflow:hidden}
.orb{position:absolute;left:8%;top:12%;width:110px;height:110px;border-radius:50%;background:var(--st-accent);box-shadow:0 0 70px color-mix(in srgb,var(--st-accent) 80%,transparent)}
st-code{position:absolute;left:8%;right:8%;top:31%;bottom:8%}
@media (max-aspect-ratio:1/1){.world{width:88%;height:82%}.orb{top:8%}st-code{top:25%;bottom:6%}}
</style></head><body><main class="world"><div class="orb"></div><st-code input="source" reveal-range="reveal"></st-code></main>${extraBody}
<script>
const r=window.__showtell.inputs.reveal;
const tl=gsap.timeline({paused:true});
tl.fromTo('.orb',{x:0,scale:.72,opacity:.25},{x:window.__showtell.viewport.width*.5,scale:1.16,opacity:1,duration:r.durationSec,ease:'none'},r.startSec);
window.__showtell.timeline=tl;
</script></body></html>`,
  );
  writeFileSync(
    join(bundleDir, "spec.json"),
    JSON.stringify(
      {
        version: 3,
        meta: {
          title: "Browser frame test",
          fps: 30,
          aspectRatios: ["16:9"],
          repo: { path: "../repo" },
          theme: { preset: "aurora" },
        },
        audio: { tts: { provider: "say" }, captions: { mode: "off" } },
        scenes: [
          {
            id: "motion",
            narration: { lines: [{ id: "l1", text: narration }] },
            refs: { motionSource: { kind: "code", file: "motion.ts", lineStart: 1, lineEnd: 3 } },
            visual: {
              kind: "web",
              src: "hyperframes/motion.html",
              inputs: { source: "motionSource", reveal: "line:l1" },
            },
          },
        ],
      },
      null,
      2,
    ) + "\n",
  );
  return { bundleDir, cacheDir, repoDir };
}

test.skipIf(!browserAvailable)(
  "web frames seek deterministically, move across exact timestamps, and include live repo pixels",
  async () => {
    const fixture = webFixture();
    const runtime = await compileBundle(fixture.bundleDir, { cacheDir: fixture.cacheDir });
    const scene = runtime.spec.scenes[0]!;
    const planScene = runtime.plan.scenes[0]!;
    const line = planScene.narration.lines[0]!;
    const renderer = new WebFrameRenderer(runtime);
    try {
      const firstExact = exactBundleFrameAt(
        planScene,
        { timeMs: lineSampleTimeMs(line, 0, 30), preferredLineIndex: 0 },
        30,
      );
      const lastExact = exactBundleFrameAt(
        planScene,
        { timeMs: lineSampleTimeMs(line, 1, 30), preferredLineIndex: 0 },
        30,
      );
      const first = await renderer.capture(scene, planScene, "16:9", firstExact);
      const repeated = await renderer.capture(scene, planScene, "16:9", firstExact);
      const last = await renderer.capture(scene, planScene, "16:9", lastExact);

      expect(first.sha256).toBe(repeated.sha256);
      expect(last.sha256).not.toBe(first.sha256);
      expect(first).toMatchObject({ width: 1920, height: 1080 });
      expect(first.resolvedRefs[0]).toMatchObject({ file: "motion.ts" });
      expect(first.resolvedRefs[0]!.text).toContain("export function progress");
    } finally {
      await renderer.close();
    }
  },
  60_000,
);

test.skipIf(!browserAvailable)(
  "render rejects repo bytes changed after compile instead of diverging from the plan",
  async () => {
    const fixture = webFixture();
    const runtime = await compileBundle(fixture.bundleDir, { cacheDir: fixture.cacheDir });
    const scene = runtime.spec.scenes[0]!;
    const planScene = runtime.plan.scenes[0]!;
    const line = planScene.narration.lines[0]!;
    writeFileSync(join(fixture.repoDir, "motion.ts"), "export const changedAfterCompile = true;\n");

    const renderer = new WebFrameRenderer(runtime);
    try {
      const exact = exactBundleFrameAt(planScene, lineSampleTimeMs(line, 0.5, 30), 30);
      await expect(renderer.capture(scene, planScene, "16:9", exact)).rejects.toThrow(
        'Repo ref "motionSource" changed after compile',
      );
    } finally {
      await renderer.close();
    }
  },
  60_000,
);

test("web bundle compilation rejects outbound resources before browser launch", async () => {
  const fixture = webFixture('<img src="https://example.com/blocked.png">');
  await expect(compileBundle(fixture.bundleDir, { cacheDir: fixture.cacheDir })).rejects.toMatchObject({
    errors: [expect.objectContaining({ code: "BANNED_WEB_RESOURCE", path: "scenes.0.visual.src" })],
  });
});

test.skipIf(!browserAvailable)(
  "review and direct capture share the exact authored browser pixels",
  async () => {
    const fixture = webFixture();
    const review = await reviewBundle(fixture.bundleDir, {
      outDir: mkdtempSync(join(tmpdir(), "showtell-web-review-")),
      cacheDir: fixture.cacheDir,
      aspectRatios: ["16:9"],
      samplesPerLine: 2,
    });
    const sample = review.scenes[0]!.lines[0]!.samples[0]!;
    expect(sample.baseSha256).toMatch(/^[0-9a-f]{64}$/);
    expect(new Set(review.scenes[0]!.lines[0]!.samples.map((item) => item.baseSha256)).size).toBeGreaterThan(1);
    expect(review.scenes[0]!.lines[0]!.advisory.basePixelDeltaMax).toBeGreaterThan(0);

    const runtime = await compileBundle(fixture.bundleDir, { cacheDir: fixture.cacheDir });
    const renderer = new WebFrameRenderer(runtime);
    try {
      const planScene = runtime.plan.scenes[0]!;
      const exact = exactBundleFrameAt(planScene, { timeMs: sample.timeMs, preferredLineIndex: 0 }, 30);
      const direct = await renderer.capture(runtime.spec.scenes[0]!, planScene, "16:9", exact);
      expect(direct.sha256).toBe(sample.baseSha256);
    } finally {
      await renderer.close();
    }
  },
  60_000,
);

test.skipIf(!browserAvailable)(
  "recompiling changed live repo bytes changes st-code pixels",
  async () => {
    const fixture = webFixture();
    const firstRuntime = await compileBundle(fixture.bundleDir, { cacheDir: fixture.cacheDir });
    const firstRenderer = new WebFrameRenderer(firstRuntime);
    const firstScene = firstRuntime.plan.scenes[0]!;
    const firstLine = firstScene.narration.lines[0]!;
    const exact = exactBundleFrameAt(firstScene, lineSampleTimeMs(firstLine, 0.8, 30), 30);
    const first = await firstRenderer
      .capture(firstRuntime.spec.scenes[0]!, firstScene, "16:9", exact)
      .finally(() => firstRenderer.close());

    writeFileSync(
      join(fixture.repoDir, "motion.ts"),
      "export function progress(time: number) {\n  const eased = time * time;\n  return Math.min(1, eased / 1000000);\n}\n",
    );
    const secondRuntime = await compileBundle(fixture.bundleDir, { cacheDir: fixture.cacheDir });
    const secondRenderer = new WebFrameRenderer(secondRuntime);
    const secondScene = secondRuntime.plan.scenes[0]!;
    const second = await secondRenderer
      .capture(secondRuntime.spec.scenes[0]!, secondScene, "16:9", exact)
      .finally(() => secondRenderer.close());
    expect(second.resolvedRefs[0]!.text).toContain("const eased");
    expect(second.sha256).not.toBe(first.sha256);
  },
  60_000,
);

test.skipIf(!browserAvailable)(
  "bundle v3 renders animated web frames into a timed MP4",
  async () => {
    const fixture = webFixture();
    const outDir = mkdtempSync(join(tmpdir(), "showtell-web-render-"));
    const result = await renderBundle(fixture.bundleDir, {
      outDir,
      cacheDir: fixture.cacheDir,
      aspectRatios: ["16:9"],
    });
    expect(result.plan.sourceVersion).toBe(3);
    expect(result.outputs).toHaveLength(1);
    expect(statSync(result.outputs[0]!.path).size).toBeGreaterThan(10_000);
    expect(Math.abs(result.outputs[0]!.durationMs - result.plan.meta.durationMs)).toBeLessThanOrEqual(34);
    expect(result.resolvedCode[0]).toMatchObject({ scene: 0, file: "motion.ts" });
  },
  120_000,
);

test.skipIf(!browserAvailable)(
  "v3 browser frames adapt to 9:16 and share renderer-owned caption chrome",
  async () => {
    const fixture = webFixture(`<script>
const st = window.__showtell;
const safeTop = Number.parseFloat(getComputedStyle(document.documentElement).getPropertyValue("--st-safe-top"));
if (!st.presenter.enabled || st.presenter.position !== "top-center") throw new Error("portrait presenter was not resolved");
if (st.presenter.safeArea.top <= 0 || st.safeArea.top !== st.presenter.safeArea.top || safeTop !== st.safeArea.top) {
  throw new Error("presenter safe area was not integrated into the browser frame");
}
</script>`);
    const specPath = join(fixture.bundleDir, "spec.json");
    const spec = JSON.parse(readFileSync(specPath, "utf-8"));
    spec.meta.aspectRatios = ["16:9", "9:16"];
    spec.meta.presenter = { image: "assets/avatar.png", model: "Codex", position: "auto", size: "md" };
    spec.audio.captions.mode = "burn-in";
    mkdirSync(join(fixture.bundleDir, "assets"), { recursive: true });
    writeFileSync(join(fixture.bundleDir, "assets", "avatar.png"), tinyPng);
    writeFileSync(specPath, JSON.stringify(spec, null, 2) + "\n");

    const runtime = await compileBundle(fixture.bundleDir, { cacheDir: fixture.cacheDir });
    expect(runtime.plan.scenes[0]!.program).toMatchObject({
      kind: "web",
      runtime: {
        engine: "chromium",
        chromiumRevision: "1228",
        gsap: "3.14.2",
      },
    });
    expect(runtime.plan.meta.presenter).toMatchObject({
      image: { src: "assets/avatar.png", width: 1, height: 1 },
      position: "auto",
      size: "md",
    });
    expect(runtime.presenter).toMatchObject({ position: "auto", size: "md" });
    const scene = runtime.spec.scenes[0]!;
    const planScene = runtime.plan.scenes[0]!;
    const line = planScene.narration.lines[0]!;
    const firstExact = exactBundleFrameAt(planScene, lineSampleTimeMs(line, 0, 30), 30);
    const lastExact = exactBundleFrameAt(planScene, lineSampleTimeMs(line, 1, 30), 30);
    const producer = createBundleFrameProducer(runtime);
    try {
      const first = await producer.render({
        scene,
        compiledScene: planScene,
        aspectRatio: "9:16",
        exact: firstExact,
        diagnostics: true,
        presentation: { watermark: "showtell", caption: line.text, presenterAmplitude: 0 },
      });
      const last = await producer.render({
        scene,
        compiledScene: planScene,
        aspectRatio: "9:16",
        exact: lastExact,
        diagnostics: true,
        presentation: { watermark: "showtell", caption: line.text, presenterAmplitude: 0 },
      });
      const withoutPresenter = await producer.render({
        scene,
        compiledScene: planScene,
        aspectRatio: "9:16",
        exact: firstExact,
        presentation: { watermark: false, caption: line.text },
      });
      const withPresenter = await producer.render({
        scene,
        compiledScene: planScene,
        aspectRatio: "9:16",
        exact: firstExact,
        presentation: { watermark: false, caption: line.text, presenterAmplitude: 0.5 },
      });
      expect(first).toMatchObject({ width: 1080, height: 1920 });
      expect(createHash("sha256").update(first.basePng).digest("hex")).not.toBe(
        createHash("sha256").update(last.basePng).digest("hex"),
      );
      expect(createHash("sha256").update(first.basePng).digest("hex")).not.toBe(
        createHash("sha256").update(first.png).digest("hex"),
      );
      expect(createHash("sha256").update(withPresenter.png).digest("hex")).not.toBe(
        createHash("sha256").update(withoutPresenter.png).digest("hex"),
      );
    } finally {
      await producer.close();
    }
  },
  60_000,
);

test.skipIf(!browserAvailable)(
  "web visuals must publish one seekable paused GSAP timeline",
  async () => {
    const fixture = webFixture();
    const sourcePath = join(fixture.bundleDir, "hyperframes", "motion.html");
    // Assign a non-seekable value: static lint sees an assignment, so the
    // independent runtime guard is what must reject the missing pause()/seek().
    writeFileSync(
      sourcePath,
      readFileSync(sourcePath, "utf-8").replace("window.__showtell.timeline=tl;", "window.__showtell.timeline={};"),
    );
    const runtime = await compileBundle(fixture.bundleDir, { cacheDir: fixture.cacheDir });
    const scene = runtime.spec.scenes[0]!;
    const planScene = runtime.plan.scenes[0]!;
    const exact = exactBundleFrameAt(planScene, lineSampleTimeMs(planScene.narration.lines[0]!, 0.5, 30), 30);
    const renderer = new WebFrameRenderer(runtime);
    try {
      await expect(renderer.capture(scene, planScene, "16:9", exact)).rejects.toThrow(
        "has no seekable paused GSAP timeline",
      );
    } finally {
      await renderer.close();
    }
  },
  60_000,
);

test.skipIf(!browserAvailable)(
  "runtime rejects computed Web Crypto and Web Animations bypasses",
  async () => {
    const fixture = webFixture(
      '<script>document.addEventListener("showtell:frame",()=>{globalThis["cryp"+"to"]["getRandom"+"Values"](new Uint8Array(1));globalThis["docu"+"ment"]["body"]["ani"+"mate"]([],{duration:1000})},{once:true});</script>',
    );
    const runtime = await compileBundle(fixture.bundleDir, { cacheDir: fixture.cacheDir });
    const scene = runtime.spec.scenes[0]!;
    const planScene = runtime.plan.scenes[0]!;
    const exact = exactBundleFrameAt(planScene, lineSampleTimeMs(planScene.narration.lines[0]!, 0.5, 30), 30);
    const renderer = new WebFrameRenderer(runtime);
    try {
      const error = await renderer.capture(scene, planScene, "16:9", exact).catch((caught: unknown) => caught);
      expect(error).toBeInstanceOf(Error);
      expect((error as Error).message).toContain("crypto.getRandomValues is disabled");
      expect((error as Error).message).toContain("Web Animations API is disabled");
    } finally {
      await renderer.close();
    }
  },
  60_000,
);

test.skipIf(!browserAvailable)(
  "runtime rejects computed network, timer, and randomness bypasses",
  async () => {
    const fixture = webFixture(
      '<script>document.addEventListener("showtell:frame",()=>{globalThis["fe"+"tch"]("http://127.0.0.1/x");globalThis["setTime"+"out"](()=>{},1);globalThis["Ma"+"th"]["ran"+"dom"]();new (globalThis["WebSoc"+"ket"])("ws://127.0.0.1/x");new (globalThis["Wor"+"ker"])("data:,")},{once:true});</script>',
    );
    const runtime = await compileBundle(fixture.bundleDir, { cacheDir: fixture.cacheDir });
    const scene = runtime.spec.scenes[0]!;
    const planScene = runtime.plan.scenes[0]!;
    const exact = exactBundleFrameAt(planScene, lineSampleTimeMs(planScene.narration.lines[0]!, 0.5, 30), 30);
    const renderer = new WebFrameRenderer(runtime);
    try {
      const error = await renderer.capture(scene, planScene, "16:9", exact).catch((caught: unknown) => caught);
      expect(error).toBeInstanceOf(Error);
      for (const api of ["fetch", "setTimeout", "Math.random", "WebSocket", "Worker"]) {
        expect((error as Error).message).toContain(api);
      }
    } finally {
      await renderer.close();
    }
  },
  60_000,
);

test("decorateHtml keeps the doctype first on head-less documents (no quirks mode)", () => {
  const source = '<!doctype html>\n<meta charset="utf-8">\n<body><main></main></body>';
  const decorated = decorateHtml(source, { probe: 1 });
  expect(decorated.toLowerCase().startsWith("<!doctype html>")).toBe(true);
  expect(decorated).toContain("Content-Security-Policy");
});

test("decorateHtml injects at the start of <head> when present", () => {
  const source = "<!doctype html><html><head><title>t</title></head><body></body></html>";
  const decorated = decorateHtml(source, { probe: 1 });
  const csp = decorated.indexOf("Content-Security-Policy");
  expect(csp).toBeGreaterThan(decorated.indexOf("<head>"));
  expect(csp).toBeLessThan(decorated.indexOf("<title>"));
});
