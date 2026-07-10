import { test, expect, beforeAll, afterAll } from "bun:test";
import { execFileSync } from "node:child_process";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { VideoSpec } from "@showtell/core";
import { renderVideo } from "../src/index.ts";

let repo: string;
const g = (...a: string[]) => execFileSync("git", ["-C", repo, ...a], { encoding: "utf-8" });

beforeAll(() => {
  repo = mkdtempSync(join(tmpdir(), "av-warn-"));
  g("init", "-q");
  g("config", "user.email", "t@t");
  g("config", "user.name", "t");
  writeFileSync(join(repo, "stable.ts"), "export const a = 1;\n");
  g("add", ".");
  g("commit", "-q", "-m", "one");
  writeFileSync(join(repo, "other.ts"), "export const b = 2;\n"); // stable.ts unchanged
  g("add", ".");
  g("commit", "-q", "-m", "two");
});
afterAll(() => rmSync(repo, { recursive: true, force: true }));

test("an empty diff scene renders but emits a warning", async () => {
  const spec: VideoSpec = {
    meta: {
      title: "w",
      fps: 30,
      aspectRatios: ["16:9"],
      watermark: true,
      tts: { provider: "say" },
      repo: { path: "." },
    },
    scenes: [
      {
        kind: "diff",
        content: { file: "stable.ts", ref: "HEAD~1..HEAD", animation: "magic-move" },
        narration: "no change.",
        duration: "auto",
      },
    ],
  };
  const r = await renderVideo(spec, {
    repoPath: repo,
    outDir: join(repo, "out"),
    baseName: "w",
    aspectRatios: ["16:9"],
  });
  expect(r.outputs).toHaveLength(1); // still renders
  expect(r.warnings.length).toBeGreaterThan(0);
  expect(r.warnings[0]!.message).toContain("EMPTY");
}, 30_000);
