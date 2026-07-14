import { expect, test } from "bun:test";
import { existsSync, mkdtempSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { VideoSpec } from "@showtell/core";
import { lowerSimpleSpec } from "../src/simple-bundle.ts";

test("simple specs lower to web programs plus screencap media with no alternate visual runtime", () => {
  const spec: VideoSpec = {
    meta: { title: "Lowering", fps: 30, aspectRatios: ["16:9"], watermark: false, repo: { path: "." } },
    scenes: [
      { kind: "title", content: { heading: "One runtime" }, narration: "Title.", duration: "auto" },
      {
        kind: "code",
        content: { file: "package.json", lineStart: 1, lineEnd: 4 },
        narration: "Code.",
        duration: "auto",
      },
      {
        kind: "diff",
        content: { file: "package.json", ref: "HEAD..HEAD", animation: "fade" },
        narration: "Diff.",
        duration: "auto",
      },
      {
        kind: "talking-points",
        content: { heading: "Proof", points: ["Web", "Motion"] },
        narration: "Points.",
        duration: "auto",
      },
      {
        kind: "chart",
        content: { chartType: "line", title: "Growth", data: [{ label: "now", value: 4 }] },
        narration: "Chart.",
        duration: "auto",
      },
      {
        kind: "screencap",
        content: { source: "browser", sessionRef: "demo", playback: { mode: "smart" } },
        narration: "Capture.",
        duration: 1.25,
      },
    ],
  };
  const bundleDir = mkdtempSync(join(tmpdir(), "showtell-lowering-"));
  const lowered = lowerSimpleSpec(spec, { bundleDir, repoPath: "." });
  const bundle = JSON.parse(readFileSync(join(lowered.bundleDir, "spec.json"), "utf8"));

  expect(lowered.sceneMap).toEqual([0, 1, 2, 3, 4, 5]);
  expect(bundle.scenes.slice(0, 5).every((scene: { visual: { kind: string } }) => scene.visual.kind === "web")).toBe(
    true,
  );
  expect(bundle.scenes[5].visual).toMatchObject({ kind: "screencap", sessionRef: "demo" });
  expect(bundle.scenes[5].duration).toBe(1.25);
  expect(bundle.scenes.some((scene: { visual: { kind: string } }) => scene.visual.kind === "builtin")).toBe(false);
  expect(existsSync(join(bundleDir, "hyperframes", "scene-000.html"))).toBe(true);
  expect(existsSync(join(bundleDir, "assets", "data", "scene-004.json"))).toBe(true);
});
