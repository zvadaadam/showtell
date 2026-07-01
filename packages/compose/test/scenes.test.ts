import { test, expect } from "bun:test";
import type { Scene } from "@agent-video/core";
import { renderSceneToPng, COMPOSABLE_KINDS } from "../src/index.ts";
import { legendItems, parseChartData, valueScale } from "../src/primitives/chart.ts";

const opts = { repoPath: ".", aspectRatio: "16:9" as const };

test("COMPOSABLE_KINDS includes built-in still visuals", () => {
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

test("chart legends follow the chart type", () => {
  const parsed = parseChartData([
    { label: "a", current: 1, previous: 2 },
    { label: "b", current: 3, previous: 4 },
  ]);
  expect(legendItems("pie", parsed).map((i) => i.label)).toEqual(["a", "b"]);
  expect(
    legendItems(
      "line",
      parseChartData([
        { label: "a", value: 1 },
        { label: "b", value: 2 },
      ]),
    ),
  ).toEqual([]);
  expect(
    legendItems(
      "bar",
      parseChartData([
        { label: "a", value: 1 },
        { label: "b", value: 2 },
      ]),
    ).map((i) => i.label),
  ).toEqual(["a", "b"]);
});

test("chart parsing honors explicit x/y fields", () => {
  const parsed = parseChartData(
    [
      { label: "wrong-a", stage: "compile", noise: 99, weight: 4 },
      { label: "wrong-b", stage: "render", noise: 88, weight: 7 },
    ],
    { x: "stage", y: "weight" },
  );

  expect(parsed.labels).toEqual(["compile", "render"]);
  expect(parsed.series).toEqual([{ name: "weight", values: [4, 7] }]);
});

test("bar and line charts scale negative values around a zero baseline", () => {
  const s = valueScale([-10, 20], 100, 200);
  const zeroY = s.yFor(0);
  expect(s.min).toBeLessThan(0);
  expect(s.max).toBeGreaterThan(0);
  expect(s.yFor(20)).toBeLessThan(zeroY);
  expect(s.yFor(-10)).toBeGreaterThan(zeroY);
});
