import { test, expect, beforeAll, afterAll } from "bun:test";
import { execFileSync } from "node:child_process";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { resolveDiff } from "../src/index.ts";

let repo: string;
const g = (...a: string[]) => execFileSync("git", ["-C", repo, ...a], { encoding: "utf-8" });

beforeAll(() => {
  repo = mkdtempSync(join(tmpdir(), "av-diff-"));
  g("init", "-q");
  g("config", "user.email", "t@t");
  g("config", "user.name", "t");
  writeFileSync(join(repo, "f.ts"), "const a = 1;\nconst b = 2;\nconst c = 3;\n");
  g("add", ".");
  g("commit", "-q", "-m", "one");
  writeFileSync(join(repo, "f.ts"), "const a = 1;\nconst b = 20;\nconst c = 3;\nconst d = 4;\n");
  g("add", ".");
  g("commit", "-q", "-m", "two");
});
afterAll(() => rmSync(repo, { recursive: true, force: true }));

test("resolveDiff reads the real git diff (counts + parsed lines)", () => {
  const d = resolveDiff(repo, { file: "f.ts", ref: "HEAD~1..HEAD", animation: "magic-move" });
  expect(d.added).toBe(2); // b changed + d added
  expect(d.removed).toBe(1); // old b
  expect(d.lines.some((l) => l.kind === "add" && l.content.includes("const b = 20"))).toBe(true);
  expect(d.lines.some((l) => l.kind === "del" && l.content.includes("const b = 2"))).toBe(true);
  expect(d.lines.some((l) => l.kind === "add" && l.content.includes("const d = 4"))).toBe(true);
});

test("CONTRACT: resolved diff == git diff output (live bytes, not pasted)", () => {
  const d = resolveDiff(repo, { file: "f.ts", ref: "HEAD~1..HEAD", animation: "magic-move" });
  const independent = g("diff", "--no-color", "HEAD~1..HEAD", "--", "f.ts");
  expect(d.rawText).toBe(independent);
});
