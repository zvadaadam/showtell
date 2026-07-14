import { test, expect } from "bun:test";
import { readFileSync, rmSync, existsSync, statSync } from "node:fs";
import { createHash } from "node:crypto";
import { join } from "node:path";
import { tmpdir } from "node:os";
import type { VideoSpec } from "@showtell/core";
import { renderFrames } from "../src/index.ts";

const outDir = join(tmpdir(), "showtell-test-frames");

const spec: VideoSpec = {
  meta: { title: "t", fps: 30, aspectRatios: ["16:9", "9:16"], watermark: true, repo: { path: "." } },
  scenes: [
    { kind: "title", content: { heading: "Hi" }, narration: "intro", duration: "auto" },
    {
      kind: "code",
      content: { file: "packages/core/src/spec.ts", lineStart: 1, lineEnd: 5 },
      narration: "code",
      duration: "auto",
    },
  ],
};

test("renders all scenes × aspect ratios to real PNG files", async () => {
  rmSync(outDir, { recursive: true, force: true });
  const r = await renderFrames(spec, { repoPath: ".", outDir });
  expect(r.frames).toHaveLength(4); // 2 scenes × 2 ratios
  expect(r.skipped).toHaveLength(0);
  for (const f of r.frames) {
    expect(existsSync(f.path)).toBe(true);
    expect(statSync(f.path).size).toBeGreaterThan(1000); // real PNG, not empty
  }
  // dimensions per ratio
  const wide = r.frames.find((f) => f.aspectRatio === "16:9")!;
  const tall = r.frames.find((f) => f.aspectRatio === "9:16")!;
  expect([wide.width, wide.height]).toEqual([1920, 1080]);
  expect([tall.width, tall.height]).toEqual([1080, 1920]);
}, 60_000);

test("CONTRACT: rendered code == live source bytes", async () => {
  const r = await renderFrames(spec, { repoPath: ".", outDir });
  const code = r.resolvedCode.find((c) => c.scene === 1)!;
  const lines = readFileSync("packages/core/src/spec.ts", "utf-8").split("\n");
  const independent = createHash("sha256").update(lines.slice(0, 5).join("\n")).digest("hex");
  expect(code.sha256).toBe(independent);
}, 60_000);

test("not-yet-composable kinds are reported in `skipped`, not rendered", async () => {
  const r = await renderFrames(
    { ...spec, scenes: [{ kind: "screencap", content: { source: "app" }, narration: "x", duration: "auto" }] },
    { repoPath: ".", outDir },
  );
  expect(r.frames).toHaveLength(0);
  expect(r.skipped[0]!.kind).toBe("screencap");
});
