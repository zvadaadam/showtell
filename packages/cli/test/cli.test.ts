import { test, expect } from "bun:test";
import { execFileSync, spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import { cpSync, existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const CLI = join(import.meta.dir, "..", "src", "index.ts");
const ROOT = join(import.meta.dir, "..", "..", "..");
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
  cpSync(join(ROOT, "examples", "bundle-v2"), dir, { recursive: true });
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

function miniHyperframeBundle(): string {
  const dir = mkdtempSync(join(tmpdir(), "av-cli-workshop-"));
  mkdirSync(join(dir, "hyperframes"), { recursive: true });
  writeFileSync(
    join(dir, "hyperframes", "frame.tsx"),
    [
      "/* @jsx h */",
      'import { Stage, Text, h, defineHyperframe } from "@showtell/hyperframes";',
      'const propsSchema = { type: "object", additionalProperties: false, required: ["title"], properties: { title: { type: "string" } } };',
      "const inputs = {};",
      "function render(ctx) {",
      '  return <Stage tone="dark" padding="xl"><Text variant="title">{ctx.props.title}</Text></Stage>;',
      "}",
      "export default defineHyperframe({ schemaVersion: 1, propsSchema, inputs, render });",
    ].join("\n"),
  );
  const spec = {
    audio: { tts: { provider: "say" } },
    version: 2,
    meta: { title: "Workshop mini", repo: { path: ROOT }, aspectRatios: ["16:9"] },
    scenes: [
      {
        id: "intro",
        narration: { lines: [{ id: "l1", text: "This workshop frame renders one line." }] },
        visual: { kind: "hyperframe", src: "hyperframes/frame.tsx", props: { title: "Workshop mini" } },
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
  expect(out).toMatchObject({ name: "showtell" });
});

test("help and component discovery use the Showtell public surface", () => {
  const components = run(["bundle", "components"]);
  expect(components.code).toBe(0);
  expect(components.out).toMatchObject({ package: "@showtell/hyperframes" });

  const help = run(["help"]);
  expect(help.code).toBe(0);
  expect(help.out).toContain("showtell — A motion engine for agents.");
  expect(help.out).toContain("showtell <command>");
  expect(help.out).toContain("@showtell/hyperframes");
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

test("bundle validate → ok:true with hyperframes", () => {
  const { code, out } = run(["bundle", "validate", "examples/bundle-v2"]);
  expect(code).toBe(0);
  const o = out as { ok: boolean; hyperframes: unknown[] };
  expect(o.ok).toBe(true);
  expect(o.hyperframes.length).toBeGreaterThan(0);
});

test("bundle inspect → hyperframe contracts and implicit beats", () => {
  const { code, out } = run(["bundle", "inspect", "examples/bundle-v2"]);
  expect(code).toBe(0);
  const o = out as {
    ok: boolean;
    stage: string;
    scenes: {
      beats: { source: string; items: { id: string }[] };
      visual: {
        kind: string;
        inputs: { name: string; kind: string; required: boolean; value: unknown }[];
      };
    }[];
  };
  expect(o).toMatchObject({ ok: true, stage: "bundle-inspect" });
  expect(o.scenes[0]!.beats.source).toBe("implicit-per-line");
  expect(o.scenes[0]!.beats.items.map((beat) => beat.id)).toContain("l1");
  expect(o.scenes[0]!.visual.kind).toBe("hyperframe");
  expect(o.scenes[0]!.visual.inputs.find((input) => input.name === "source")).toMatchObject({
    kind: "repo",
    required: true,
    value: "contract",
  });
  expect(o.scenes[0]!.visual.inputs.find((input) => input.name === "metrics")).toMatchObject({
    kind: "asset",
    required: true,
    value: "metrics",
  });
  expect(o.scenes[0]!.visual.inputs.find((input) => input.name === "reveal")).toMatchObject({
    kind: "range",
    required: true,
    value: "line:l2",
  });
});

test("bundle templates → reusable hyperframe starter list", () => {
  const { code, out } = run(["bundle", "templates"]);
  expect(code).toBe(0);
  const o = out as {
    ok: boolean;
    stage: string;
    package: string;
    templates: { id: string; path: string; visualCaption?: boolean }[];
  };
  expect(o).toMatchObject({ ok: true, stage: "bundle-templates", package: "@showtell/hyperframes" });
  expect(o.templates.map((template) => template.id)).toContain("code-kinetic-caption");
  expect(o.templates.some((template) => template.visualCaption)).toBe(true);
});

test("bundle components → reusable hyperframe component kit", () => {
  const { code, out } = run(["bundle", "components"]);
  expect(code).toBe(0);
  const o = out as {
    ok: boolean;
    stage: string;
    package: string;
    components: { importName: string; layer: string }[];
  };
  expect(o).toMatchObject({ ok: true, stage: "bundle-components", package: "@showtell/hyperframes" });
  expect(o.components).toContainEqual(expect.objectContaining({ importName: "DecisionGrid", layer: "story" }));
  expect(o.components).toContainEqual(expect.objectContaining({ importName: "CodeRef", layer: "media" }));
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
  const dir = miniHyperframeBundle();
  const outDir = mkdtempSync(join(tmpdir(), "av-cli-workshop-out-"));
  const { code, out } = run(["bundle", "workshop", dir, "--out", outDir, "--aspect", "16:9"]);
  expect(code).toBe(0);
  const o = out as { ok: boolean; stage: string; frames: { sceneId?: string; lineId?: string; path?: string }[] };
  expect(o).toMatchObject({ ok: true, stage: "bundle-workshop" });
  expect(o.frames).toHaveLength(1);
  expect(o.frames[0]).toMatchObject({ sceneId: "intro", lineId: "l1" });
}, 30_000);

test("workshop render → built-in component gallery", () => {
  const outDir = mkdtempSync(join(tmpdir(), "av-cli-component-workshop-"));
  const { code, out } = run(["workshop", "render", "--out", outDir, "--aspect", "16:9"]);
  expect(code).toBe(0);
  const o = out as { ok: boolean; stage: string; frames: { id: string }[] };
  expect(o).toMatchObject({ ok: true, stage: "workshop-render" });
  expect(o.frames.map((frame) => frame.id)).toContain("signal-wall");
}, 30_000);

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
