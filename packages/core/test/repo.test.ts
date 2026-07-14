import { test, expect, beforeEach, afterEach } from "bun:test";
import { execFileSync } from "node:child_process";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { readFileAtRef, readRepoMeta, resolveCodeRef, resolveDiff } from "../src/repo.ts";

let repo: string;

beforeEach(() => {
  repo = mkdtempSync(join(tmpdir(), "av-repo-ref-"));
  writeFileSync(join(repo, "a.ts"), "one\ntwo\n");
});

afterEach(() => rmSync(repo, { recursive: true, force: true }));

test("working-tree code refs must stay repo-relative", () => {
  expect(() => readFileAtRef(repo, "/etc/hosts")).toThrow(/relative/);
  expect(() => readFileAtRef(repo, "../outside.ts")).toThrow(/inside the repo/);
  expect(() => readFileAtRef(repo, "nested\\..\\..\\outside.ts")).toThrow(/inside the repo/);
});

test("working-tree code refs wrap unreadable repo paths", () => {
  expect(() => readFileAtRef(join(repo, "missing"), "a.ts")).toThrow(/Unsafe working-tree file "a.ts"/);
});

test("repo metadata is empty for a non-git directory", () => {
  expect(readRepoMeta(repo)).toEqual({ commit: undefined, branch: undefined });
});

test("git diff refs also reject paths outside the repo", () => {
  expect(() => resolveDiff(repo, { file: "../outside.ts", ref: "HEAD" })).toThrow(/inside the repo/);
});

test("git refs reject option-like, colon, and control characters before invoking git", () => {
  for (const ref of ["-x", "main:HEAD", "HEAD\nmain", "HEAD\tmain"]) {
    expect(() => readFileAtRef(repo, "a.ts", ref)).toThrow(/Git ref\/range/);
    expect(() => resolveDiff(repo, { file: "a.ts", ref })).toThrow(/Git ref\/range/);
  }
});

test("safe git refs can read committed files and ranges", () => {
  execFileSync("git", ["-C", repo, "init", "-q"]);
  execFileSync("git", ["-C", repo, "config", "user.email", "t@t"]);
  execFileSync("git", ["-C", repo, "config", "user.name", "t"]);
  execFileSync("git", ["-C", repo, "add", "a.ts"]);
  execFileSync("git", ["-C", repo, "commit", "-q", "-m", "one"]);
  writeFileSync(join(repo, "a.ts"), "one\ntwo\nthree\n");
  execFileSync("git", ["-C", repo, "add", "a.ts"]);
  execFileSync("git", ["-C", repo, "commit", "-q", "-m", "two"]);

  expect(readFileAtRef(repo, "a.ts", "HEAD~1")).toBe("one\ntwo\n");
  const diff = resolveDiff(repo, { file: "a.ts", ref: "HEAD~1..HEAD" });
  expect(diff.added).toBe(1);
});

test("lineStart past EOF fails instead of rendering an empty code scene", () => {
  expect(() => resolveCodeRef(repo, { file: "a.ts", lineStart: 99, lineEnd: 100 })).toThrow(/past end/);
});

test("reading to EOF does not add a phantom trailing line", () => {
  const r = resolveCodeRef(repo, { file: "a.ts" });
  expect(r.text).toBe("one\ntwo");
  expect(r.endLine).toBe(2);
});
