import { test, expect } from "bun:test";
import type { Scene } from "@showtell/core";
import { KineticCaption, Stage, h, hyperframeComponents } from "@showtell/hyperframes";
import { renderSceneToPng, renderHyperframeElementToPng, COMPOSABLE_KINDS } from "../src/index.ts";
import { legendItems, parseChartData, valueScale } from "../src/primitives/chart.ts";
import { RENDERABLE_COMPONENT_TYPES } from "../src/render-hyperframe-tree.ts";

const opts = { repoPath: ".", aspectRatio: "16:9" as const };

test("COMPOSABLE_KINDS includes built-in still visuals", () => {
  for (const k of ["title", "code", "diff", "talking-points", "chart"]) {
    expect(COMPOSABLE_KINDS as readonly string[]).toContain(k);
  }
});

test("hyperframe component manifest matches the compose render registry", () => {
  const INTERNAL_COMPONENTS = [] as const;
  const manifestNames = new Set(hyperframeComponents.map((component) => component.importName));
  const renderableNames = new Set(RENDERABLE_COMPONENT_TYPES);
  const internalNames = new Set<string>(INTERNAL_COMPONENTS);

  expect([...manifestNames].filter((name) => !renderableNames.has(name)).sort()).toEqual([]);
  expect([...renderableNames].filter((name) => !manifestNames.has(name) && !internalNames.has(name)).sort()).toEqual(
    [],
  );
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

test("kinetic caption emphasis changes pixels and stays deterministic", async () => {
  const activeCue = {
    sceneId: "s1",
    lineId: "l1",
    text: "Alpha, beta gamma",
    startMs: 0,
    endMs: 1000,
  };
  const withoutEmphasis = h(
    Stage,
    { padding: "xl" },
    h(KineticCaption, { source: "narration", mode: "minimal", position: "middle" }),
  );
  const withEmphasis = h(
    Stage,
    { padding: "xl" },
    h(KineticCaption, { source: "narration", mode: "minimal", position: "middle", emphasis: ["alpha"] }),
  );

  const plain = await renderHyperframeElementToPng(withoutEmphasis, {
    aspectRatio: "16:9",
    activeCue,
    watermark: false,
  });
  const accented = await renderHyperframeElementToPng(withEmphasis, {
    aspectRatio: "16:9",
    activeCue,
    watermark: false,
  });
  const accentedAgain = await renderHyperframeElementToPng(withEmphasis, {
    aspectRatio: "16:9",
    activeCue,
    watermark: false,
  });

  expect(plain.png.equals(accented.png)).toBe(false);
  expect(accented.png.equals(accentedAgain.png)).toBe(true);
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
  // Single-series bars render in one accent hue, so a per-label legend would
  // be redundant with the x-axis labels.
  expect(
    legendItems(
      "bar",
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
        { label: "a", current: 1, previous: 2 },
        { label: "b", current: 3, previous: 4 },
      ]),
    ).map((i) => i.label),
  ).toEqual(["current", "previous"]);
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

test("chart parsing preserves numeric strings for explicit y fields", () => {
  const parsed = parseChartData(
    [
      { stage: "compile", weight: "4" },
      { stage: "render", weight: "7" },
    ],
    { x: "stage", y: "weight" },
  );

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
