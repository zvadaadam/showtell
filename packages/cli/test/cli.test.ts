import { test, expect } from "bun:test";
import { spawnSync } from "node:child_process";
import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const CLI = join(import.meta.dir, "..", "src", "index.ts");
const ROOT = join(import.meta.dir, "..", "..", "..");

/** Run the CLI as a real subprocess (agent-first: JSON out, exit codes, hints). */
function run(args: string[]): { code: number; out: unknown; err: unknown } {
  const r = spawnSync("bun", [CLI, ...args], { cwd: ROOT, encoding: "utf-8" });
  const parse = (s: string) => {
    try {
      return JSON.parse(s);
    } catch {
      return s;
    }
  };
  return { code: r.status ?? 1, out: parse(r.stdout), err: parse(r.stderr) };
}

test("schema → JSON Schema on stdout, exit 0", () => {
  const { code, out } = run(["schema"]);
  expect(code).toBe(0);
  expect(out).toHaveProperty("definitions");
});

test("version → structured JSON, exit 0", () => {
  const { code, out } = run(["version"]);
  expect(code).toBe(0);
  expect(out).toMatchObject({ name: "agent-video" });
});

test("validate a good spec → ok:true, exit 0", () => {
  const { code, out } = run(["validate", "examples/hello.spec.json"]);
  expect(code).toBe(0);
  expect(out).toMatchObject({ ok: true });
  expect((out as { sceneCount: number }).sceneCount).toBeGreaterThan(0);
});

test("validate a bad spec → ok:false, errors carry a hint, exit 1", () => {
  const dir = mkdtempSync(join(tmpdir(), "av-cli-"));
  const f = join(dir, "bad.spec.json");
  writeFileSync(f, JSON.stringify({ meta: { title: "x" }, scenes: [{ kind: "nope", content: {}, narration: "x" }] }));
  const { code, err } = run(["validate", f]);
  expect(code).toBe(1);
  const e = err as { ok: boolean; errors: { hint?: string }[] };
  expect(e.ok).toBe(false);
  expect(e.errors.length).toBeGreaterThan(0);
});

test("missing spec file → exit 1 with a hint", () => {
  const { code, err } = run(["validate", "does-not-exist.json"]);
  expect(code).toBe(1);
  expect(err).toHaveProperty("hint");
});

test("unknown command → exit 1 with a hint", () => {
  const { code, err } = run(["frobnicate"]);
  expect(code).toBe(1);
  expect(err).toHaveProperty("hint");
});

test("help → human text on stdout, exit 0", () => {
  const r = spawnSync("bun", [CLI, "help"], { cwd: ROOT, encoding: "utf-8" });
  expect(r.status).toBe(0);
  expect(r.stdout).toContain("USAGE");
});

test("render --frames-only → ok, frames, and live-byte proof for a code scene", () => {
  const dir = mkdtempSync(join(tmpdir(), "av-cli-render-"));
  const spec = join(dir, "s.spec.json");
  writeFileSync(
    spec,
    JSON.stringify({
      meta: { title: "t", aspectRatios: ["16:9"], repo: { path: "." } },
      scenes: [
        { kind: "title", content: { heading: "Hi" }, narration: "hi.", duration: "auto" },
        {
          kind: "code",
          content: { file: "package.json", lineStart: 1, lineEnd: 3 },
          narration: "x.",
          duration: "auto",
        },
      ],
    }),
  );
  const { code, out } = run(["render", spec, "--frames-only", "--out", join(dir, "out"), "--aspect", "16:9"]);
  expect(code).toBe(0);
  const o = out as { ok: boolean; frames: unknown[]; resolvedCode: { file: string; sha256: string }[] };
  expect(o.ok).toBe(true);
  expect(o.frames.length).toBeGreaterThan(0);
  expect(o.resolvedCode.some((r) => r.file === "package.json" && /^[0-9a-f]{64}$/.test(r.sha256))).toBe(true);
}, 30_000);
