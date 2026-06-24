import { test, expect } from "bun:test";
import { buildManifest, VideoManifest, type VideoSpec } from "../src/index.ts";

const spec = {
  meta: { title: "T", fps: 30, aspectRatios: ["16:9"], watermark: true, repo: { path: "." } },
  scenes: [
    { kind: "title", content: { heading: "h" }, narration: "intro", duration: "auto" },
    { kind: "code", content: { file: "a.ts", lineStart: 1, lineEnd: 5 }, narration: "code here", duration: "auto" },
  ],
} as unknown as VideoSpec;

test("buildManifest assembles cumulative timings, refs, thumbnails, basenames", () => {
  const m = buildManifest({
    spec,
    outputs: [{ aspectRatio: "16:9", path: "/tmp/out/T-16x9.mp4", durationMs: 5000 }],
    scenes: [
      { scene: 0, kind: "title", durationSec: 2 },
      { scene: 1, kind: "code", durationSec: 3 },
    ],
    thumbnails: { 0: "thumb-000.png", 1: "thumb-001.png" },
    repo: { path: ".", commit: "abc123", branch: "main" },
    generatedAt: "2026-01-01T00:00:00.000Z",
  });

  expect(m.version).toBe(1);
  expect(m.durationSec).toBe(5);
  expect(m.meta.repo.commit).toBe("abc123");

  // cumulative start offsets
  expect(m.scenes[0]!.startSec).toBe(0);
  expect(m.scenes[1]!.startSec).toBe(2);

  // refs only for code/diff
  expect(m.scenes[0]!.refs).toBeUndefined();
  expect(m.scenes[1]!.refs!.file).toBe("a.ts");
  expect(m.scenes[1]!.refs!.lineStart).toBe(1);
  expect(m.scenes[1]!.refs!.lineEnd).toBe(5);

  // thumbnails + output basename
  expect(m.scenes[1]!.thumbnail).toBe("thumb-001.png");
  expect(m.outputs[0]!.file).toBe("T-16x9.mp4");

  // self-validates against the published schema
  expect(() => VideoManifest.parse(m)).not.toThrow();
});
