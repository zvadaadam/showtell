import { test, expect } from "bun:test";
import type { BundleScene } from "@agent-video/core";
import type { CompiledBundleScene } from "../src/bundle.ts";
import { resolveBundlePoint, resolveBundleRange, resolveBundleSpan } from "../src/bundle-time.ts";

const totalMs = 2_200;

function specScene(id: string, ranges: BundleScene["ranges"] = {}, anchors: BundleScene["anchors"] = []): BundleScene {
  return {
    id,
    duration: "auto",
    narration: {
      lines: [
        { id: "l1", text: "Line one." },
        { id: "lx", text: "Line x." },
      ],
    },
    refs: {},
    beats: [],
    anchors,
    ranges,
    visual: { kind: "builtin", name: "title", props: { title: id } },
  };
}

function compiledScene(id: string, index: number, startMs: number): CompiledBundleScene {
  const firstLineStart = startMs;
  const firstLineEnd = startMs + 400;
  const secondLineStart = startMs + 500;
  const secondLineEnd = startMs + 900;
  return {
    index,
    id,
    startMs,
    endMs: startMs + 1_000,
    durationMs: 1_000,
    narration: {
      lines: [
        {
          id: "l1",
          text: "Line one.",
          startMs: firstLineStart,
          endMs: firstLineEnd,
          durationMs: 400,
          ttsCached: false,
        },
        {
          id: "lx",
          text: "Line x.",
          startMs: secondLineStart,
          endMs: secondLineEnd,
          durationMs: 400,
          ttsCached: false,
        },
      ],
    },
    beats: {
      b1: { lines: ["l1"], startMs: firstLineStart, endMs: firstLineEnd, durationMs: 400 },
      bx: { lines: ["lx"], startMs: secondLineStart, endMs: secondLineEnd, durationMs: 400 },
    },
    anchors: {},
    ranges: {},
    refs: {},
    visual: { kind: "builtin", name: "title", props: { title: id } },
  };
}

function fixtures(): { compiled: CompiledBundleScene[]; specs: BundleScene[] } {
  return {
    compiled: [compiledScene("sceneA", 0, 0), compiledScene("sceneB", 1, 1_000)],
    specs: [
      specScene("sceneA", {
        firstLine: "line:l1",
        indirect: "range:firstLine",
        self: "range:self",
        crossScene: "line:sceneB/lx",
        badOrder: { from: "line:l1@end", to: "line:l1@start" },
      }),
      specScene("sceneB", {
        otherLine: "line:lx",
      }),
    ],
  };
}

test("resolveBundlePoint resolves fractional beat positions with rounded duration math", () => {
  const { compiled, specs } = fixtures();
  expect(resolveBundlePoint("beat:b1@0.5", "sceneA", compiled, specs, totalMs)).toBe(200);
});

test("resolveBundlePoint uses explicit cross-scene scopes and current-scene unscoped refs", () => {
  const { compiled, specs } = fixtures();
  expect(resolveBundlePoint("line:sceneB/lx@start", "sceneA", compiled, specs, totalMs)).toBe(1_500);
  expect(resolveBundlePoint("line:lx@start", "sceneA", compiled, specs, totalMs)).toBe(500);
});

test("resolveBundleRange caches resolved ranges on the compiled scene", () => {
  const { compiled, specs } = fixtures();
  const first = resolveBundleRange("sceneA", "firstLine", compiled, specs, totalMs);
  expect(first).toEqual({ startMs: 0, endMs: 400, durationMs: 400 });
  expect(compiled[0]!.ranges.firstLine).toBe(first);
  expect(resolveBundleRange("sceneA", "firstLine", compiled, specs, totalMs)).toBe(first);
});

test("resolveBundleRange follows named range indirection", () => {
  const { compiled, specs } = fixtures();
  expect(resolveBundleRange("sceneA", "indirect", compiled, specs, totalMs)).toEqual({
    startMs: 0,
    endMs: 400,
    durationMs: 400,
  });
});

test("resolveBundleRange detects direct and indirect cycles", () => {
  const { compiled, specs } = fixtures();
  expect(() => resolveBundleRange("sceneA", "self", compiled, specs, totalMs)).toThrow(/cycle/);

  const indirectSpecs = [specScene("sceneA", { one: "range:two", two: "range:one" }), specScene("sceneB")];
  const indirectCompiled = [compiledScene("sceneA", 0, 0), compiledScene("sceneB", 1, 1_000)];
  expect(() => resolveBundleRange("sceneA", "one", indirectCompiled, indirectSpecs, totalMs)).toThrow(/cycle/);
});

test("resolveBundlePoint detects anchor cycles", () => {
  const specs = [
    specScene("sceneA", {}, [
      { id: "a1", at: "anchor:sceneA/a2" },
      { id: "a2", at: "anchor:sceneA/a1" },
      { id: "self", at: "anchor:sceneA/self" },
    ]),
    specScene("sceneB"),
  ];
  const compiled = [compiledScene("sceneA", 0, 0), compiledScene("sceneB", 1, 1_000)];
  expect(() => resolveBundlePoint("anchor:sceneA/a1", "sceneA", compiled, specs, totalMs)).toThrow(/Anchor cycle/);
  expect(() => resolveBundlePoint("anchor:sceneA/self", "sceneA", compiled, specs, totalMs)).toThrow(/Anchor cycle/);
});

test("resolveBundleSpan rejects ranges that do not move forward", () => {
  const { compiled, specs } = fixtures();
  expect(() =>
    resolveBundleSpan({ from: "line:l1@end", to: "line:l1@start" }, "sceneA", compiled, specs, totalMs),
  ).toThrow(/does not move forward/);
});

test("resolveBundleRange rejects named ranges that do not move forward", () => {
  const { compiled, specs } = fixtures();
  expect(() => resolveBundleRange("sceneA", "badOrder", compiled, specs, totalMs)).toThrow(/does not move forward/);
});

test("resolver errors echo unknown refs", () => {
  const { compiled, specs } = fixtures();
  for (const ref of ["scene:missing@start", "line:missing@start", "beat:missing@start", "anchor:sceneA/missing"]) {
    expect(() => resolveBundlePoint(ref, "sceneA", compiled, specs, totalMs)).toThrow(ref);
  }
  expect(() => resolveBundleSpan("scene:missing", "sceneA", compiled, specs, totalMs)).toThrow("scene:missing");
  expect(() => resolveBundleSpan("line:missing", "sceneA", compiled, specs, totalMs)).toThrow("line:missing");
  expect(() => resolveBundleSpan("beat:missing", "sceneA", compiled, specs, totalMs)).toThrow("beat:missing");
  expect(() => resolveBundleRange("missing", "r1", compiled, specs, totalMs)).toThrow('Unknown scene "missing"');
});

test.skip("unknown range refs echo the original range ref", () => {
  // TODO: source currently throws Unknown range "sceneA/missing" instead of echoing the author ref.
  const { compiled, specs } = fixtures();
  expect(() => resolveBundlePoint("range:missing@start", "sceneA", compiled, specs, totalMs)).toThrow(
    "range:missing@start",
  );
  expect(() => resolveBundleSpan("range:missing", "sceneA", compiled, specs, totalMs)).toThrow("range:missing");
});
