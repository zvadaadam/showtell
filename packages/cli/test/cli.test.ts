import { test, expect } from "bun:test";
import { execFileSync, spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import { cpSync, existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { chromium } from "playwright";
import rootManifest from "../../../package.json" with { type: "json" };

const CLI = join(import.meta.dir, "..", "src", "index.ts");
const ROOT = join(import.meta.dir, "..", "..", "..");
const browserAvailable = existsSync(chromium.executablePath());
type BundleSpecForTest = {
  audio?: { tts?: { provider?: string; voice?: string; model?: string } };
  scenes: { narration: { lines: { text: string }[] } }[];
};

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

function tempBundle(): string {
  const dir = mkdtempSync(join(tmpdir(), "av-cli-bundle-"));
  cpSync(join(ROOT, "examples", "bundle-v3"), dir, { recursive: true });
  rmSync(join(dir, ".showtell"), { recursive: true, force: true });
  rmSync(join(dir, "compiled-plan.json"), { force: true });
  const specPath = join(dir, "spec.json");
  const spec = JSON.parse(readFileSync(specPath, "utf-8")) as BundleSpecForTest & { meta: { repo: { path: string } } };
  spec.meta.repo.path = ROOT;
  writeFileSync(specPath, JSON.stringify(spec, null, 2) + "\n");
  seedSayTtsCache(dir, spec);
  return dir;
}

function seedSayTtsCache(bundleDir: string, spec: BundleSpecForTest): void {
  const tts = spec.audio?.tts;
  if (tts?.provider && tts.provider !== "say") return;
  const cacheDir = join(bundleDir, ".showtell", "cache", "tts");
  mkdirSync(cacheDir, { recursive: true });
  for (const line of spec.scenes.flatMap((scene) => scene.narration.lines)) {
    const key = createHash("sha256")
      .update(JSON.stringify({ provider: "say", voice: tts?.voice ?? "", model: tts?.model ?? "", text: line.text }))
      .digest("hex")
      .slice(0, 32);
    execFileSync("ffmpeg", [
      "-y",
      "-loglevel",
      "error",
      "-f",
      "lavfi",
      "-i",
      "anullsrc=r=44100:cl=mono",
      "-t",
      "0.4",
      join(cacheDir, `say-${key}.wav`),
    ]);
  }
}

function miniWebBundle(): string {
  const dir = mkdtempSync(join(tmpdir(), "av-cli-web-"));
  mkdirSync(join(dir, "hyperframes"), { recursive: true });
  writeFileSync(
    join(dir, "hyperframes", "frame.html"),
    [
      "<!doctype html><html><head>",
      '<script type="application/showtell+json">{"schemaVersion":3,"inputs":{"reveal":{"kind":"range"}}}</script>',
      "<style>body{margin:0;background:var(--st-bg);color:var(--st-fg)}</style>",
      "</head><body><main>Web motion</main>",
      '<script>const r=window.__showtell.inputs.reveal;const tl=gsap.timeline({paused:true});tl.fromTo("main",{opacity:0},{opacity:1,duration:r.durationSec},r.startSec);window.__showtell.timeline=tl;</script>',
      "</body></html>",
    ].join(""),
  );
  const spec = {
    audio: { tts: { provider: "say" } },
    version: 3,
    meta: { title: "Web mini", repo: { path: ROOT }, aspectRatios: ["16:9"] },
    scenes: [
      {
        id: "intro",
        narration: { lines: [{ id: "l1", text: "This web visual follows one measured line." }] },
        visual: { kind: "web", src: "hyperframes/frame.html", inputs: { reveal: "line:l1" } },
      },
    ],
  };
  writeFileSync(join(dir, "spec.json"), JSON.stringify(spec));
  seedSayTtsCache(dir, spec);
  return dir;
}

test("schema → JSON Schema on stdout, exit 0", () => {
  const { code, out } = run(["schema"]);
  expect(code).toBe(0);
  expect(out).toHaveProperty("definitions");
});

test("version → structured JSON, exit 0", () => {
  const { code, out } = run(["version"]);
  expect(code).toBe(0);
  expect(out).toEqual({ name: "showtell", version: rootManifest.version });
});

test("help and component discovery use the Showtell public surface", () => {
  const components = run(["bundle", "components"]);
  expect(components.code).toBe(0);
  expect(components.out).toMatchObject({ runtime: { kind: "web", bundleVersion: 3 } });

  const help = run(["help"]);
  expect(help.code).toBe(0);
  expect(help.out).toContain("showtell — A motion engine for agents.");
  expect(help.out).toContain("showtell <command>");
  expect(help.out).toContain("version 3 browser/screencap bundle");
  expect(help.out).not.toContain("TSX compatibility");
  expect(help.out).toContain(".showtell/workshop");
});

test("skill install writes the bundled Showtell skill idempotently", () => {
  const dir = mkdtempSync(join(tmpdir(), "showtell-skill-"));
  const first = run(["skill", "install", "--dir", dir]);
  expect(first.code).toBe(0);
  expect(first.out).toMatchObject({ ok: true, stage: "skill-install" });
  const skillPath = join(dir, "showtell", "SKILL.md");
  expect(readFileSync(skillPath, "utf-8")).toContain("name: showtell");

  const second = run(["skill", "install", "--dir", dir]);
  expect(second.code).toBe(0);
  expect(readFileSync(skillPath, "utf-8")).toContain("# Showtell");
});

test("validate a good spec → ok:true, exit 0", () => {
  const { code, out } = run(["validate", "examples/hello.spec.json"]);
  expect(code).toBe(0);
  expect(out).toMatchObject({ ok: true });
  expect((out as { sceneCount: number }).sceneCount).toBeGreaterThan(0);
});

test("bundle schema → JSON Schema on stdout, exit 0", () => {
  const { code, out } = run(["bundle", "schema"]);
  expect(code).toBe(0);
  expect(out).toHaveProperty("definitions");
});

test("bundle validate reports the version 2 migration error as structured JSON", () => {
  const dir = mkdtempSync(join(tmpdir(), "av-cli-old-bundle-"));
  writeFileSync(
    join(dir, "spec.json"),
    JSON.stringify({
      version: 2,
      meta: { title: "Old", repo: { path: ROOT } },
      scenes: [
        {
          id: "intro",
          narration: { lines: [{ id: "l1", text: "Old." }] },
          visual: { kind: "builtin", name: "title" },
        },
      ],
    }),
  );

  const result = run(["bundle", "validate", dir]);
  expect(result.code).toBe(1);
  expect(result.err).toMatchObject({
    ok: false,
    errors: [
      {
        code: "UNSUPPORTED_BUNDLE_VERSION",
        path: "version",
        hint: expect.stringContaining('visual.kind="web"'),
      },
    ],
  });
});

test("bundle v3 validate and inspect expose the browser runtime contract", () => {
  const dir = miniWebBundle();
  const validated = run(["bundle", "validate", dir]);
  expect(validated.code).toBe(0);
  expect(validated.out).toMatchObject({
    ok: true,
    sourceVersion: 3,
    visuals: [{ scene: "intro", runtime: "web", src: "hyperframes/frame.html" }],
  });

  const inspected = run(["bundle", "inspect", dir]);
  expect(inspected.code).toBe(0);
  const output = inspected.out as {
    meta: { sourceVersion: number };
    scenes: {
      beats: { source: string; items: { id: string }[] };
      visual: {
        kind: string;
        runtime: { engine: string; chromiumRevision: string; gsap: string };
        manifestVersion: number;
        inputs: { name: string }[];
      };
    }[];
  };
  expect(output.meta.sourceVersion).toBe(3);
  expect(output.scenes[0]!.beats.source).toBe("implicit-per-line");
  expect(output.scenes[0]!.beats.items.map((beat) => beat.id)).toEqual(["l1"]);
  expect(output.scenes[0]!.visual).toMatchObject({
    kind: "web",
    runtime: { engine: "chromium", chromiumRevision: "1228", gsap: "3.14.2" },
    manifestVersion: 3,
  });
  expect(output.scenes[0]!.visual.inputs).toContainEqual(expect.objectContaining({ name: "reveal" }));
});

test("bundle templates → focused v3 browser starter source", () => {
  const { code, out } = run(["bundle", "templates"]);
  expect(code).toBe(0);
  const o = out as {
    ok: boolean;
    stage: string;
    sourceVersion: number;
    runtime: { kind: string; bundleVersion: number };
    templates: { id: string; file: string; source: string }[];
  };
  expect(o).toMatchObject({
    ok: true,
    stage: "bundle-templates",
    sourceVersion: 3,
    runtime: { kind: "web", bundleVersion: 3 },
  });
  expect(o.templates.map((template) => template.id)).toContain("motion-world");
  expect(o.templates[0]!.source).toContain("gsap.timeline({ paused: true })");
});

test("bundle components → focused v3 web runtime discovery", () => {
  const { code, out } = run(["bundle", "components"]);
  expect(code).toBe(0);
  const o = out as {
    ok: boolean;
    stage: string;
    sourceVersion: number;
    runtime: { kind: string; bundleVersion: number };
    components: { tag: string }[];
    cssVariables: string[];
  };
  expect(o).toMatchObject({
    ok: true,
    stage: "bundle-components",
    sourceVersion: 3,
    runtime: { kind: "web", bundleVersion: 3 },
  });
  expect(o.components).toContainEqual(expect.objectContaining({ tag: "st-code" }));
  expect(o.cssVariables).toContain("--st-accent");
});

test("removed bundle legacy flag fails uniformly with a migration hint", () => {
  for (const command of ["schema", "templates", "components", "validate"]) {
    const result = run(["bundle", command, "--legacy"]);
    expect(result.code).toBe(1);
    expect(result.err).toMatchObject({
      ok: false,
      error: "The --legacy flag is no longer supported.",
      hint: expect.stringContaining("version 3"),
    });
  }
});

test.skipIf(!browserAvailable)("bundle runtime → pinned Chromium launches and captures a frame", () => {
  const { code, out } = run(["bundle", "runtime"]);
  expect(code).toBe(0);
  expect(out).toMatchObject({
    ok: true,
    stage: "bundle-runtime",
    identity: { engine: "chromium", chromiumRevision: "1228", gsap: "3.14.2" },
  });
  expect((out as { captureBytes: number }).captureBytes).toBeGreaterThan(100);
});

test("bundle compile → measured plan and refs", () => {
  const dir = tempBundle();
  const { code, out } = run(["bundle", "compile", dir]);
  expect(code).toBe(0);
  const o = out as { ok: boolean; stage: string; durationMs: number; refs: unknown[] };
  expect(o).toMatchObject({ ok: true, stage: "bundle-compile" });
  expect(o.durationMs).toBeGreaterThan(0);
  expect(o.refs.length).toBeGreaterThan(0);
}, 30_000);

test("bundle workshop → static rendered frame gallery", () => {
  const dir = miniWebBundle();
  const outDir = mkdtempSync(join(tmpdir(), "av-cli-workshop-out-"));
  const { code, out } = run(["bundle", "workshop", dir, "--out", outDir, "--aspect", "16:9"]);
  expect(code).toBe(0);
  const o = out as { ok: boolean; stage: string; frames: { sceneId?: string; lineId?: string; path?: string }[] };
  expect(o).toMatchObject({ ok: true, stage: "bundle-workshop" });
  expect(o.frames).toHaveLength(1);
  expect(o.frames[0]).toMatchObject({ sceneId: "intro", lineId: "l1" });
}, 30_000);

test("bundle review → exact timestamp filmstrip gallery and manifest", () => {
  const dir = miniWebBundle();
  const outDir = mkdtempSync(join(tmpdir(), "av-cli-review-out-"));
  const { code, out } = run([
    "bundle",
    "review",
    dir,
    "--out",
    outDir,
    "--aspect",
    "16:9",
    "--samples",
    "3",
    "--scene",
    "intro",
  ]);
  expect(code).toBe(0);
  const o = out as {
    ok: boolean;
    stage: string;
    indexPath: string;
    manifestPath: string;
    samplesPerLine: number;
    scenes: { id: string; lines: { samples: { timeMs: number; frame: number; path: string; sha256: string }[] }[] }[];
  };
  expect(o).toMatchObject({ ok: true, stage: "bundle-review", samplesPerLine: 3 });
  expect(existsSync(o.indexPath)).toBe(true);
  expect(existsSync(o.manifestPath)).toBe(true);
  expect(o.scenes.map((scene) => scene.id)).toEqual(["intro"]);
  expect(o.scenes[0]!.lines[0]!.samples).toHaveLength(3);
  expect(o.scenes[0]!.lines[0]!.samples.every((sample) => existsSync(sample.path))).toBe(true);
  const sampleTimes = o.scenes[0]!.lines[0]!.samples.map((sample) => sample.timeMs);
  expect(sampleTimes).toEqual([...sampleTimes].sort((a, b) => a - b));
}, 30_000);

test("bundle review rejects invalid samples with a repair hint", () => {
  const dir = miniWebBundle();
  const { code, err } = run(["bundle", "review", dir, "--samples", "1"]);
  expect(code).toBe(1);
  expect(err).toMatchObject({ ok: false, hint: "Pass --samples as an integer between 2 and 60." });

  const tooMany = run(["bundle", "review", join(dir, "missing"), "--samples", "61"]);
  expect(tooMany.code).toBe(1);
  expect(tooMany.err).toMatchObject({ ok: false, hint: "Pass --samples as an integer between 2 and 60." });
});

test("bundle review unknown scene reports valid scene ids", () => {
  const dir = miniWebBundle();
  const { code, err } = run(["bundle", "review", dir, "--scene", "missing"]);
  expect(code).toBe(1);
  expect(err).toMatchObject({ ok: false });
  expect((err as { hint?: string }).hint).toContain("intro");
});

test("bundle help mentions review without removed legacy flags", () => {
  const help = run(["bundle", "help"]);
  expect(help.code).toBe(0);
  const helpJson = JSON.stringify(help.out);
  expect(helpJson).toContain("review");
  expect(helpJson).not.toContain("--legacy");
});

test("bundle review without a directory returns review guidance", () => {
  const missing = run(["bundle", "review"]);
  expect(missing.code).toBe(1);
  expect(JSON.stringify(missing.err)).toContain("review");
});

test("unknown bundle commands return bundle guidance", () => {
  const unknown = run(["bundle", "frobnicate"]);
  expect(unknown.code).toBe(1);
  expect(JSON.stringify(unknown.err)).toContain("review");
});

test("bundle render → mp4 output and compiled plan", () => {
  const dir = tempBundle();
  const outDir = mkdtempSync(join(tmpdir(), "av-cli-bundle-out-"));
  const { code, out } = run(["bundle", "render", dir, "--out", outDir, "--aspect", "16:9"]);
  expect(code).toBe(0);
  const o = out as { ok: boolean; stage: string; durationMs: number; outputs: { path: string; durationMs: number }[] };
  expect(o).toMatchObject({ ok: true, stage: "bundle-render" });
  expect(o.outputs).toHaveLength(1);
  expect(o.outputs[0]!.durationMs).toBeGreaterThan(0);
}, 120_000);

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

test("render --frames-only before positional does not swallow the spec path", () => {
  const outDir = mkdtempSync(join(tmpdir(), "av-cli-frames-before-"));
  const { code, out } = run([
    "render",
    "--frames-only",
    "examples/hello.spec.json",
    "--out",
    outDir,
    "--aspect",
    "16:9",
  ]);
  expect(code).toBe(0);
  expect(out).toMatchObject({ ok: true, stage: "frames", outDir });
}, 30_000);

test("render --frames-only after positional still works", () => {
  const outDir = mkdtempSync(join(tmpdir(), "av-cli-frames-after-"));
  const { code, out } = run([
    "render",
    "examples/hello.spec.json",
    "--frames-only",
    "--out",
    outDir,
    "--aspect",
    "16:9",
  ]);
  expect(code).toBe(0);
  expect(out).toMatchObject({ ok: true, stage: "frames", outDir });
}, 30_000);

test("preview rejects invalid port with a flag-specific hint", () => {
  const { code, err } = run(["preview", "examples/hello.spec.json", "--port", "abc"]);
  expect(code).toBe(1);
  expect(err).toMatchObject({ ok: false });
  expect((err as { hint?: string }).hint).toContain("--port");
});

test("--out=value equals form still parses", () => {
  const outDir = mkdtempSync(join(tmpdir(), "av-cli-out-equals-"));
  const { code, out } = run([
    "render",
    "examples/hello.spec.json",
    "--frames-only",
    `--out=${outDir}`,
    "--aspect",
    "16:9",
  ]);
  expect(code).toBe(0);
  expect(out).toMatchObject({ ok: true, stage: "frames", outDir });
}, 30_000);

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
