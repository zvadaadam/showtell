import { test, expect } from "bun:test";
import { parseBundleTimePointRef, parseBundleTimeSpanRef } from "../src/bundle-time.ts";

test("parseBundleTimePointRef parses supported point refs exactly", () => {
  expect(parseBundleTimePointRef("video@start")).toEqual({ kind: "video", pos: "start" });
  expect(parseBundleTimePointRef("video@end")).toEqual({ kind: "video", pos: "end" });
  expect(parseBundleTimePointRef("scene:intro@end")).toEqual({ kind: "scene", sceneId: "intro", pos: "end" });
  expect(parseBundleTimePointRef("line:l1@start")).toEqual({ kind: "line", id: "l1", pos: "start" });
  expect(parseBundleTimePointRef("line:intro/l1@end")).toEqual({
    kind: "line",
    sceneId: "intro",
    id: "l1",
    pos: "end",
  });
  expect(parseBundleTimePointRef("beat:b1@start")).toEqual({ kind: "beat", id: "b1", pos: "start" });
  expect(parseBundleTimePointRef("beat:b1@0.5")).toEqual({ kind: "beat", id: "b1", pos: 0.5 });
  expect(parseBundleTimePointRef("beat:b1@1.0")).toEqual({ kind: "beat", id: "b1", pos: 1 });
  expect(parseBundleTimePointRef("beat:other/b2@0.25")).toEqual({
    kind: "beat",
    sceneId: "other",
    id: "b2",
    pos: 0.25,
  });
  expect(parseBundleTimePointRef("range:r1@end")).toEqual({ kind: "range", id: "r1", pos: "end" });
  expect(parseBundleTimePointRef("anchor:intro/a1")).toEqual({ kind: "anchor", sceneId: "intro", id: "a1" });
});

test("parseBundleTimeSpanRef parses supported span refs exactly", () => {
  expect(parseBundleTimeSpanRef("video")).toEqual({ kind: "video" });
  expect(parseBundleTimeSpanRef("scene:intro")).toEqual({ kind: "scene", sceneId: "intro" });
  expect(parseBundleTimeSpanRef("line:l1")).toEqual({ kind: "line", id: "l1" });
  expect(parseBundleTimeSpanRef("beat:intro/b1")).toEqual({ kind: "beat", sceneId: "intro", id: "b1" });
  expect(parseBundleTimeSpanRef("range:r1")).toEqual({ kind: "range", id: "r1" });
});

test("parseBundleTimePointRef rejects malformed point refs", () => {
  const longId = `a${"b".repeat(64)}`;
  for (const ref of [
    "",
    "beat:b1@1.5",
    "beat:b1@-0.1",
    "scene:@start",
    "line:l1",
    "anchor:a1",
    "line:1bad@start",
    `line:${longId}@start`,
    "bogus:x@start",
  ]) {
    expect(parseBundleTimePointRef(ref)).toBeUndefined();
  }
});
