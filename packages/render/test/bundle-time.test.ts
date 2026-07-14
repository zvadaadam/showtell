import { test, expect } from "bun:test";
import type { BundleScene } from "@showtell/core";
import { exactBundleFrameAt, lineSampleFractions, lineSampleTimeMs, type CompiledBundleScene } from "../src/bundle.ts";
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
    visual: { kind: "screencap", sessionRef: "fixture" },
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
          audioDurationMs: 400,
          ttsCached: false,
        },
        {
          id: "lx",
          text: "Line x.",
          startMs: secondLineStart,
          endMs: secondLineEnd,
          durationMs: 400,
          audioDurationMs: 400,
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
    visual: { kind: "screencap", sessionRef: "fixture" },
    program: { kind: "screencap" },
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

test("unknown range refs echo the original range ref", () => {
  const { compiled, specs } = fixtures();
  expect(() => resolveBundlePoint("range:missing@start", "sceneA", compiled, specs, totalMs)).toThrow(
    'Unknown range "sceneA/missing" (from ref "range:missing@start").',
  );
  expect(() => resolveBundleSpan("range:missing", "sceneA", compiled, specs, totalMs)).toThrow(
    'Unknown range "sceneA/missing" (from ref "range:missing").',
  );
});

test("exactBundleFrameAt derives line, progress, and frame from one timestamp", () => {
  const scene = compiledScene("sceneA", 0, 0);
  const boundary = exactBundleFrameAt(scene, 500, 30);
  expect(boundary.lineIndex).toBe(1);
  expect(boundary.lineId).toBe("lx");
  expect(boundary.lineActive).toBe(true);
  expect(boundary.sceneProgress).toBe(0.5);
  expect(boundary).toMatchObject({
    timeMs: 500,
    frame: 15,
    lineIndex: 1,
    lineId: "lx",
    lineActive: true,
  });

  const midpoint = exactBundleFrameAt(scene, 700, 30);
  expect(midpoint.lineIndex).toBe(1);
  expect(midpoint.lineMs).toBe(200);
  expect(midpoint.frame).toBe(21);

  const tail = exactBundleFrameAt(scene, 950, 30);
  expect(tail.lineIndex).toBe(1);
  expect(tail.lineActive).toBe(false);
  expect(tail.lineMs).toBe(450);
});

test("exactBundleFrameAt is deterministic for identical timestamps", () => {
  const scene = compiledScene("sceneA", 0, 0);
  expect(exactBundleFrameAt(scene, 733.333, 30)).toEqual(exactBundleFrameAt(scene, 733.333, 30));
});

test("lineSampleTimeMs selects evenly distributed frames from the final render schedule", () => {
  const line = compiledScene("sceneA", 0, 0).narration.lines[0]!;
  const fps = 30;
  const frameCount = Math.max(1, Math.round((line.durationMs / 1000) * fps));
  const fractions = lineSampleFractions(5);
  const samples = fractions.map((fraction) => lineSampleTimeMs(line, fraction, fps));
  const expectedFrameIndices = fractions.map((fraction) => Math.round(fraction * (frameCount - 1)));
  expect(samples).toHaveLength(5);
  expect(expectedFrameIndices).toEqual([0, 3, 6, 8, 11]);
  expect(samples).toEqual(expectedFrameIndices.map((frameIndex) => line.startMs + ((frameIndex + 0.5) / fps) * 1000));
  for (const timeMs of samples) {
    const lineLocalFrameIndex = ((timeMs - line.startMs) * fps) / 1000 - 0.5;
    expect(lineLocalFrameIndex).toBeCloseTo(Math.round(lineLocalFrameIndex), 8);
  }
  expect(samples).toEqual([...samples].sort((a, b) => a - b));
});

test("exactBundleFrameAt preserves scheduled line identity at a line end boundary", () => {
  const scene = compiledScene("sceneA", 0, 0);
  const boundary = exactBundleFrameAt(scene, { timeMs: 400, preferredLineIndex: 0 }, 30);
  expect(boundary.timeMs).toBe(400);
  expect(boundary.lineIndex).toBe(0);
  expect(boundary.lineId).toBe("l1");
  expect(boundary.lineActive).toBe(true);
  expect(boundary.lineMs).toBe(400);
});

test("exactBundleFrameAt keeps final render timestamps on the old half-frame schedule", () => {
  const scene = compiledScene("sceneA", 0, 0);
  const line = scene.narration.lines[0]!;
  const frameCount = Math.max(1, Math.round((line.durationMs / 1000) * 30));
  expect(frameCount).toBe(12);
  const lastScheduledTimeMs = line.startMs + ((frameCount - 1 + 0.5) / 30) * 1000;
  const exact = exactBundleFrameAt(scene, { timeMs: lastScheduledTimeMs, preferredLineIndex: 0 }, 30);
  expect(exact.timeMs).toBeCloseTo(383.3333333333, 8);
  expect(exact.lineIndex).toBe(0);
  expect(exact.timeMs).toBe(lastScheduledTimeMs);
});

test("exactBundleFrameAt keeps tail timestamps exact while clearing line activity", () => {
  const scene = compiledScene("sceneA", 0, 0);
  const tailTimeMs = scene.endMs + 500 / 30;
  const exact = exactBundleFrameAt(
    scene,
    { timeMs: tailTimeMs, preferredLineIndex: scene.narration.lines.length - 1, lineActive: false },
    30,
  );
  expect(exact.timeMs).toBe(tailTimeMs);
  expect(exact.timeMs).toBe(tailTimeMs);
  expect(exact.sceneProgress).toBe(1);
  expect(exact.lineIndex).toBe(1);
  expect(exact.lineActive).toBe(false);
});
