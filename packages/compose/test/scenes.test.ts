import { test, expect } from "bun:test";
import type { Scene } from "@agent-video/core";
import { renderSceneToPng, COMPOSABLE_KINDS } from "../src/index.ts";

const opts = { repoPath: ".", aspectRatio: "16:9" as const };

test("COMPOSABLE_KINDS includes the v1b compose kinds", () => {
  for (const k of ["title", "code", "diff", "talking-points", "chart"]) {
    expect(COMPOSABLE_KINDS as readonly string[]).toContain(k);
  }
});

test("talking-points renders a non-empty PNG", async () => {
  const scene = {
    kind: "talking-points",
    content: { heading: "H", points: ["a", "b"] },
    narration: "x",
    duration: "auto",
  } as Scene;
  const r = await renderSceneToPng(scene, opts);
  expect(r.png.length).toBeGreaterThan(1000);
});

test("chart renders for bar / line / pie, both orientations", async () => {
  for (const chartType of ["bar", "line", "pie"] as const) {
    for (const aspectRatio of ["16:9", "9:16"] as const) {
      const scene = {
        kind: "chart",
        content: {
          chartType,
          title: "T",
          data: [
            { l: "a", v: 1 },
            { l: "b", v: 2 },
            { l: "c", v: 3 },
          ],
        },
        narration: "x",
        duration: "auto",
      } as Scene;
      const r = await renderSceneToPng(scene, { repoPath: ".", aspectRatio });
      expect(r.png.length).toBeGreaterThan(1000);
    }
  }
});

test("a chart with no numeric data renders a placeholder + a warning", async () => {
  const scene = {
    kind: "chart",
    content: { chartType: "bar", data: [{ label: "only-a-label" }] },
    narration: "x",
    duration: "auto",
  } as Scene;
  const r = await renderSceneToPng(scene, opts);
  expect(r.png.length).toBeGreaterThan(1000); // still draws a frame (the placeholder)
  expect(r.warning).toContain("no numeric data");
});
