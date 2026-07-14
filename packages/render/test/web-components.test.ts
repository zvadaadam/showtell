import { expect, test } from "bun:test";
import { createHash } from "node:crypto";
import { execFileSync } from "node:child_process";
import { existsSync, mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { chromium } from "playwright";
import { compileBundle, exactBundleFrameAt, lineSampleTimeMs } from "../src/bundle.ts";
import { webComponentManifest, webCssVariables, webRuntimeIdentity } from "../src/web-authoring.ts";
import { webComponentsSource } from "../src/web-components.ts";
import { WebFrameRenderer } from "../src/web-frame.ts";

const browserAvailable = existsSync(chromium.executablePath());

test("web component discovery publishes typed ports and authoring examples", () => {
  expect(webComponentManifest).toEqual([
    expect.objectContaining({
      tag: "st-code",
      ports: expect.objectContaining({ input: expect.objectContaining({ kind: "repo", refKind: "code" }) }),
      example: expect.stringContaining("<st-code"),
    }),
    expect.objectContaining({
      tag: "st-diff",
      ports: expect.objectContaining({ input: expect.objectContaining({ kind: "repo", refKind: "diff" }) }),
      attributes: expect.objectContaining({ "reveal-range": expect.any(Object) }),
      example: expect.stringContaining("<st-diff"),
    }),
    expect.objectContaining({
      tag: "st-chart",
      ports: expect.objectContaining({ input: expect.objectContaining({ kind: "asset", assetType: "data" }) }),
      attributes: expect.objectContaining({ type: expect.any(Object), x: expect.any(Object), y: expect.any(Object) }),
      example: expect.stringContaining("<st-chart"),
    }),
  ]);
  expect(webCssVariables).toContain("--st-chart-1");
  expect(webCssVariables).toContain("--st-chart-10");
  expect(webRuntimeIdentity.componentsSourceSha256).toBe(
    createHash("sha256").update(webComponentsSource).digest("hex"),
  );
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

function componentHtml(manifest: object, component: string): string {
  return `<!doctype html>
<html><head><meta charset="utf-8">
<script type="application/showtell+json">${JSON.stringify(manifest)}</script>
<style>
body{background:var(--st-bg);display:grid;place-items:center}
st-diff,st-chart{display:block;width:84vw;height:76vh}
</style></head><body>${component}
<script>window.__showtell.timeline=gsap.timeline({paused:true});</script>
</body></html>`;
}

function componentFixture(): { bundleDir: string; cacheDir: string } {
  const root = mkdtempSync(join(tmpdir(), "showtell-web-components-"));
  const repoDir = join(root, "repo");
  const bundleDir = join(root, "video.showtell");
  const cacheDir = join(root, "cache");
  mkdirSync(repoDir, { recursive: true });
  mkdirSync(join(bundleDir, "hyperframes"), { recursive: true });
  mkdirSync(join(bundleDir, "assets"), { recursive: true });

  execFileSync("git", ["init", "-q", repoDir]);
  execFileSync("git", ["-C", repoDir, "config", "user.email", "showtell@example.test"]);
  execFileSync("git", ["-C", repoDir, "config", "user.name", "Showtell Test"]);
  writeFileSync(
    join(repoDir, "metrics.ts"),
    "export const values = [1, 2];\nexport const total = values.reduce((sum, value) => sum + value, 0);\n",
  );
  execFileSync("git", ["-C", repoDir, "add", "metrics.ts"]);
  execFileSync("git", ["-C", repoDir, "commit", "-qm", "baseline"]);
  writeFileSync(
    join(repoDir, "metrics.ts"),
    "export const values = [2, 4, 8];\nexport const total = values.reduce((sum, value) => sum + value, 0);\nexport const average = total / values.length;\n",
  );

  writeFileSync(
    join(bundleDir, "assets", "metrics.json"),
    JSON.stringify([
      { week: "W1", adoption: 18, retention: 42 },
      { week: "W2", adoption: 34, retention: 48 },
      { week: "W3", adoption: 57, retention: 61 },
      { week: "W4", adoption: 82, retention: 76 },
    ]),
  );

  writeFileSync(
    join(bundleDir, "hyperframes", "diff.html"),
    componentHtml(
      {
        schemaVersion: 3,
        inputs: { change: { kind: "repo", refKind: "diff" }, reveal: { kind: "range" } },
      },
      '<st-diff input="change" reveal-range="reveal" max-lines="18"></st-diff>',
    ),
  );
  for (const type of ["bar", "line", "pie"]) {
    writeFileSync(
      join(bundleDir, "hyperframes", `${type}.html`),
      componentHtml(
        {
          schemaVersion: 3,
          inputs: { metrics: { kind: "asset", assetType: "data" }, reveal: { kind: "range" } },
        },
        `<st-chart input="metrics" type="${type}" x="week" y="adoption${type === "line" ? ",retention" : ""}" title="Adoption" reveal-range="reveal"></st-chart>`,
      ),
    );
  }

  const narration = "The renderer-owned component follows one measured reveal range.";
  seedSay(cacheDir, narration);
  const chartScene = (type: "bar" | "line" | "pie") => ({
    id: type,
    narration: { lines: [{ id: "l1", text: narration }] },
    visual: {
      kind: "web",
      src: `hyperframes/${type}.html`,
      inputs: { metrics: "metrics", reveal: "line:l1" },
    },
  });
  writeFileSync(
    join(bundleDir, "spec.json"),
    JSON.stringify(
      {
        version: 3,
        meta: {
          title: "Renderer-owned browser components",
          fps: 30,
          aspectRatios: ["16:9"],
          repo: { path: "../repo" },
          theme: { preset: "aurora" },
        },
        audio: { tts: { provider: "say" }, captions: { mode: "off" } },
        assets: { metrics: { type: "data", src: "assets/metrics.json" } },
        scenes: [
          {
            id: "diff",
            narration: { lines: [{ id: "l1", text: narration }] },
            refs: { change: { kind: "diff", file: "metrics.ts", ref: "HEAD" } },
            visual: {
              kind: "web",
              src: "hyperframes/diff.html",
              inputs: { change: "change", reveal: "line:l1" },
            },
          },
          chartScene("bar"),
          chartScene("line"),
          chartScene("pie"),
        ],
      },
      null,
      2,
    ) + "\n",
  );
  return { bundleDir, cacheDir };
}

test.skipIf(!browserAvailable)(
  "st-diff and every st-chart type render deterministic narration-synced browser pixels",
  async () => {
    const fixture = componentFixture();
    const runtime = await compileBundle(fixture.bundleDir, { cacheDir: fixture.cacheDir });
    const renderer = new WebFrameRenderer(runtime);
    const finalHashes: string[] = [];
    try {
      for (let index = 0; index < runtime.plan.scenes.length; index++) {
        const scene = runtime.spec.scenes[index]!;
        const planScene = runtime.plan.scenes[index]!;
        const line = planScene.narration.lines[0]!;
        const firstExact = exactBundleFrameAt(
          planScene,
          { timeMs: lineSampleTimeMs(line, 0, 30), preferredLineIndex: 0 },
          30,
        );
        const finalExact = exactBundleFrameAt(
          planScene,
          { timeMs: lineSampleTimeMs(line, 1, 30), preferredLineIndex: 0 },
          30,
        );
        const first = await renderer.capture(scene, planScene, "16:9", firstExact);
        const final = await renderer.capture(scene, planScene, "16:9", finalExact);
        expect({ scene: scene.id, pixelsChanged: final.sha256 !== first.sha256 }).toEqual({
          scene: scene.id,
          pixelsChanged: true,
        });
        expect(final.png.length).toBeGreaterThan(10_000);
        finalHashes.push(final.sha256);

        if (scene.id === "diff") {
          expect(final.resolvedRefs).toHaveLength(1);
          expect(final.resolvedRefs[0]!.text).toContain("+export const values = [2, 4, 8]");
        }
      }

      const repeatedScene = runtime.spec.scenes[1]!;
      const repeatedPlan = runtime.plan.scenes[1]!;
      const repeatedLine = repeatedPlan.narration.lines[0]!;
      const repeatedExact = exactBundleFrameAt(
        repeatedPlan,
        { timeMs: lineSampleTimeMs(repeatedLine, 1, 30), preferredLineIndex: 0 },
        30,
      );
      const repeated = await renderer.capture(repeatedScene, repeatedPlan, "16:9", repeatedExact);
      expect(repeated.sha256).toBe(finalHashes[1]);
      expect(new Set(finalHashes).size).toBe(4);
    } finally {
      await renderer.close();
    }
  },
  60_000,
);
