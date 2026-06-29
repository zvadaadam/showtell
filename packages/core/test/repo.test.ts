import { test, expect, beforeEach, afterEach } from "bun:test";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { readFileAtRef, resolveCodeRef, resolveDiff } from "../src/repo.ts";

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

test("git diff refs also reject paths outside the repo", () => {
  expect(() => resolveDiff(repo, { file: "../outside.ts", ref: "HEAD" })).toThrow(/inside the repo/);
});

test("lineStart past EOF fails instead of rendering an empty code scene", () => {
  expect(() => resolveCodeRef(repo, { file: "a.ts", lineStart: 99, lineEnd: 100 })).toThrow(/past end/);
});

test("reading to EOF does not add a phantom trailing line", () => {
  const r = resolveCodeRef(repo, { file: "a.ts" });
  expect(r.text).toBe("one\ntwo");
  expect(r.endLine).toBe(2);
});
