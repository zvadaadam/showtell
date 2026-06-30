import { test, expect } from "bun:test";
import { execFileSync, spawnSync } from "node:child_process";
import { existsSync, mkdtempSync, writeFileSync } from "node:fs";
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

test("render --frames-only=true → frames-only mode", () => {
  const dir = mkdtempSync(join(tmpdir(), "av-cli-render-bool-"));
  const spec = join(dir, "s.spec.json");
  writeFileSync(
    spec,
    JSON.stringify({
      meta: { title: "t", aspectRatios: ["16:9"], repo: { path: "." } },
      scenes: [{ kind: "title", content: { heading: "Hi" }, narration: "hi.", duration: "auto" }],
    }),
  );
  const { code, out } = run(["render", spec, "--frames-only=true", "--out", join(dir, "out"), "--aspect", "16:9"]);
  expect(code).toBe(0);
  expect(out).toMatchObject({ ok: true, stage: "frames", frameCount: 1 });
}, 30_000);

test("capture import and capture event are structured and session-scoped", () => {
  const dir = mkdtempSync(join(tmpdir(), "av-cli-cap-"));
  const source = join(dir, "browser.webm");
  execFileSync("ffmpeg", [
    "-y",
    "-loglevel",
    "error",
    "-f",
    "lavfi",
    "-i",
    "testsrc=size=64x64:rate=10:duration=0.2",
    "-pix_fmt",
    "yuv420p",
    source,
  ]);

  const imported = run(["capture", "import", source, "--id", "browserdemo", "--repo", dir]);
  expect(imported.code).toBe(0);
  const out = imported.out as { ok: boolean; path: string; sessionId: string };
  expect(out.ok).toBe(true);
  expect(out.sessionId).toBe("browserdemo");
  expect(existsSync(out.path)).toBe(true);

  const event = run([
    "capture",
    "event",
    "--id",
    "browserdemo",
    "--repo",
    dir,
    "--type",
    "click",
    "--x",
    "10",
    "--y",
    "20",
    "--t-ms",
    "100",
  ]);
  expect(event.code).toBe(0);
  expect(event.out).toMatchObject({ ok: true, eventCount: 1 });
}, 30_000);

test("capture rejects invalid numeric recording flags before invoking the recorder", () => {
  const { code, err } = run(["capture", "--seconds", "abc"]);
  expect(code).toBe(1);
  expect(err).toMatchObject({ ok: false, hint: "Pass --seconds as a number." });
});

test("capture exec wraps a real CLI command and records an explicit event", () => {
  const dir = mkdtempSync(join(tmpdir(), "av-cli-exec-"));
  const source = join(dir, "raw.mp4");
  execFileSync("ffmpeg", [
    "-y",
    "-loglevel",
    "error",
    "-f",
    "lavfi",
    "-i",
    "testsrc=size=64x64:rate=10:duration=0.3",
    "-pix_fmt",
    "yuv420p",
    source,
  ]);

  const start = run(["capture", "start-external", source, "--id", "wrapdemo", "--repo", dir]);
  expect(start.code).toBe(0);
  expect(start.out).toMatchObject({ ok: true, sessionId: "wrapdemo" });

  const exec = run([
    "capture",
    "exec",
    "--id",
    "wrapdemo",
    "--repo",
    dir,
    "--event-type",
    "click",
    "--x",
    "10",
    "--y",
    "20",
    "--",
    "bun",
    "-e",
    "process.stdout.write('done')",
  ]);
  expect(exec.code).toBe(0);
  expect(exec.out).toMatchObject({ ok: true, event: { type: "click", x: 10, y: 20 }, eventCount: 1 });

  const stop = run(["capture", "stop-external", "--id", "wrapdemo", "--repo", dir]);
  expect(stop.code).toBe(0);
  expect(stop.out).toMatchObject({ ok: true, sessionId: "wrapdemo", eventCount: 1 });
}, 30_000);

test("capture start-external supports --source plus -- command tail", () => {
  const dir = mkdtempSync(join(tmpdir(), "av-cli-source-"));
  const source = join(dir, "raw.mp4");
  execFileSync("ffmpeg", [
    "-y",
    "-loglevel",
    "error",
    "-f",
    "lavfi",
    "-i",
    "testsrc=size=64x64:rate=10:duration=0.2",
    "-pix_fmt",
    "yuv420p",
    source,
  ]);

  const started = run([
    "capture",
    "start-external",
    "--source",
    "raw.mp4",
    "--id",
    "sourceflag",
    "--repo",
    dir,
    "--",
    "bun",
    "-e",
    "process.stdout.write('started')",
  ]);
  expect(started.code).toBe(0);
  expect(started.out).toMatchObject({ ok: true, command: { stdout: "started" } });

  const stopped = run(["capture", "stop-external", "--id", "sourceflag", "--repo", dir]);
  expect(stopped.code).toBe(0);
  expect((stopped.out as { imported: { path: string } }).imported.path).toContain("sourceflag.mp4");
}, 30_000);

test("capture exec reports command timeouts", () => {
  const dir = mkdtempSync(join(tmpdir(), "av-cli-timeout-"));
  const source = join(dir, "raw.mp4");
  execFileSync("ffmpeg", [
    "-y",
    "-loglevel",
    "error",
    "-f",
    "lavfi",
    "-i",
    "testsrc=size=64x64:rate=10:duration=0.2",
    "-pix_fmt",
    "yuv420p",
    source,
  ]);
  expect(run(["capture", "start-external", source, "--id", "timeoutdemo", "--repo", dir]).code).toBe(0);
  const timedOut = run([
    "capture",
    "exec",
    "--id",
    "timeoutdemo",
    "--repo",
    dir,
    "--timeout-ms",
    "20",
    "--",
    "bun",
    "-e",
    "setTimeout(() => {}, 1000)",
  ]);
  expect(timedOut.code).toBe(1);
  expect(timedOut.err).toMatchObject({ ok: false, timedOut: true, exitCode: 124 });
}, 30_000);

test("capture analyze reports visual activity intervals", () => {
  const dir = mkdtempSync(join(tmpdir(), "av-cli-analyze-"));
  const source = join(dir, "activity.mp4");
  execFileSync("ffmpeg", [
    "-y",
    "-loglevel",
    "error",
    "-f",
    "lavfi",
    "-i",
    "color=c=black:size=160x90:rate=30:d=1",
    "-f",
    "lavfi",
    "-i",
    "testsrc=size=160x90:rate=30:d=1",
    "-f",
    "lavfi",
    "-i",
    "color=c=black:size=160x90:rate=30:d=1",
    "-filter_complex",
    "[0:v][1:v][2:v]concat=n=3:v=1:a=0,format=yuv420p[v]",
    "-map",
    "[v]",
    source,
  ]);

  const analyzed = run(["capture", "analyze", source, "--sample-fps", "4"]);
  expect(analyzed.code).toBe(0);
  const out = analyzed.out as { ok: boolean; intervalCount: number };
  expect(out.ok).toBe(true);
  expect(out.intervalCount).toBeGreaterThan(0);
}, 30_000);

test("capture analyze missing session returns an actionable hint", () => {
  const { code, err } = run(["capture", "analyze", "--id", "missing"]);
  expect(code).toBe(1);
  expect(err).toHaveProperty("hint");
});
