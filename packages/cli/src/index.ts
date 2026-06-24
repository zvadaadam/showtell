#!/usr/bin/env bun
/**
 * agent-video CLI — agent-first by design.
 *
 * Principles (mirrors screen-studio's CLI): non-interactive, all-flags,
 * structured JSON on stdout, actionable errors with a `hint` field on stderr,
 * idempotent, self-describing via --help. A fresh agent should be able to drive
 * the whole pipeline from `--help` alone.
 */
import { readFileSync, existsSync } from "node:fs";
import { basename } from "node:path";
import { createHash, randomBytes } from "node:crypto";
import { validateSpec, videoSpecJsonSchema, IMPLEMENTED_SCENE_KINDS, type VideoSpec, type AspectRatio, type SpecError } from "@agent-video/core";
import { renderFrames, renderVideo, startPreviewServer } from "@agent-video/render";
import { recordScreen, ensureCapturesDir, sessionPath, ensureSyntheticSession } from "@agent-video/capture";

const VERSION = "0.0.0";

// ---------------------------------------------------------------------------
// Output helpers — everything an agent consumes is JSON.
// ---------------------------------------------------------------------------

function ok(data: Record<string, unknown>): never {
  process.stdout.write(JSON.stringify(data, null, 2) + "\n");
  process.exit(0);
}

function fail(error: string, hint?: string, extra?: Record<string, unknown>): never {
  const payload: Record<string, unknown> = { ok: false, error };
  if (hint) payload.hint = hint;
  if (extra) Object.assign(payload, extra);
  process.stderr.write(JSON.stringify(payload, null, 2) + "\n");
  process.exit(1);
}

// ---------------------------------------------------------------------------
// Minimal arg parsing (no deps)
// ---------------------------------------------------------------------------

interface Args {
  command: string;
  positional: string[];
  flags: Record<string, string | boolean>;
}

function parseArgs(argv: string[]): Args {
  const args = argv.slice(2);
  const command = args[0] ?? "help";
  const positional: string[] = [];
  const flags: Record<string, string | boolean> = {};
  for (let i = 1; i < args.length; i++) {
    const a = args[i]!;
    if (a.startsWith("--")) {
      const raw = a.slice(2);
      const eq = raw.indexOf("=");
      if (eq !== -1) {
        flags[raw.slice(0, eq)] = raw.slice(eq + 1);
      } else {
        const next = args[i + 1];
        if (next && !next.startsWith("--")) {
          flags[raw] = next;
          i++;
        } else {
          flags[raw] = true;
        }
      }
    } else {
      positional.push(a);
    }
  }
  return { command, positional, flags };
}

// ---------------------------------------------------------------------------
// Commands
// ---------------------------------------------------------------------------

/** Read + parse + validate a spec file, or fail() with structured output. */
function loadSpecOrFail(file: string | undefined, usage: string): { spec: VideoSpec; warnings: SpecError[] } {
  if (!file) fail("Missing spec file.", usage);
  if (!existsSync(file)) {
    fail(`Spec file not found: ${file}`, "Pass a path to a JSON spec. See `agent-video schema` for the contract.");
  }
  let raw: string;
  try {
    raw = readFileSync(file, "utf-8");
  } catch (e) {
    fail(`Could not read ${file}: ${(e as Error).message}`);
  }
  let data: unknown;
  try {
    data = JSON.parse(raw);
  } catch (e) {
    fail(`Invalid JSON in ${file}: ${(e as Error).message}`, "Fix the JSON syntax (e.g. trailing commas, unquoted keys).");
  }
  const result = validateSpec(data);
  if (!result.ok) {
    fail(`Spec failed validation (${result.errors.length} error(s)).`, "Fix each error below; the schema is strict.", {
      errors: result.errors,
      warnings: result.warnings,
    });
  }
  return { spec: result.spec, warnings: result.warnings };
}

function cmdValidate(args: Args): never {
  const file = args.positional[0];
  const { spec, warnings } = loadSpecOrFail(file, "Usage: agent-video validate <spec.json>");
  ok({
    ok: true,
    file,
    sceneCount: spec.scenes.length,
    kinds: spec.scenes.map((s) => s.kind),
    aspectRatios: spec.meta.aspectRatios,
    renderableNow: IMPLEMENTED_SCENE_KINDS,
    warnings,
  });
}

const VALID_ASPECTS: AspectRatio[] = ["16:9", "9:16", "1:1"];

async function cmdRender(args: Args): Promise<never> {
  const usage = "Usage: agent-video render <spec.json> [--out DIR] [--repo PATH] [--aspect 16:9,9:16] [--frames-only]";
  const file = args.positional[0]!;
  const { spec } = loadSpecOrFail(file, usage);

  const repoPath = (typeof args.flags.repo === "string" ? args.flags.repo : undefined) ?? spec.meta.repo.path;
  const framesOnly = args.flags["frames-only"] === true;
  const outDir =
    (typeof args.flags.out === "string" ? args.flags.out : undefined) ??
    (framesOnly ? ".agent-video/frames" : ".agent-video/out");

  let aspectRatios: AspectRatio[] | undefined;
  if (typeof args.flags.aspect === "string") {
    const requested = args.flags.aspect.split(",").map((s) => s.trim());
    const bad = requested.filter((a) => !(VALID_ASPECTS as string[]).includes(a));
    if (bad.length) fail(`Invalid aspect ratio(s): ${bad.join(", ")}`, `Valid: ${VALID_ASPECTS.join(", ")}.`);
    aspectRatios = requested as AspectRatio[];
  }

  try {
    if (framesOnly) {
      const result = await renderFrames(spec, { repoPath, outDir, aspectRatios });
      ok({ ok: true, stage: "frames", outDir: result.outDir, frameCount: result.frames.length, frames: result.frames, resolvedCode: result.resolvedCode, skipped: result.skipped });
    }
    const baseName = basename(file).replace(/\.json$/, "").replace(/\.spec$/, "");
    const result = await renderVideo(spec, { repoPath, outDir, baseName, aspectRatios });
    ok({
      ok: true,
      stage: "video",
      outDir,
      outputs: result.outputs,
      scenes: result.scenes,
      resolvedCode: result.resolvedCode,
      skipped: result.skipped,
      warnings: result.warnings,
    });
  } catch (e) {
    fail(`Render failed: ${(e as Error).message}`, "Check the failing scene's file/line reference, the repo path, and that ffmpeg is installed.");
  }
}

function specVideoId(spec: VideoSpec): string {
  return createHash("sha256").update(JSON.stringify(spec)).digest("hex").slice(0, 32);
}

async function cmdPreview(args: Args): Promise<void> {
  const usage = "Usage: agent-video preview <spec.json> [--port N] [--repo PATH] [--aspect 16:9,9:16] [--serve-seconds N]";
  const file = args.positional[0]!;
  const { spec } = loadSpecOrFail(file, usage);
  const repoPath = (typeof args.flags.repo === "string" ? args.flags.repo : undefined) ?? spec.meta.repo.path;
  const outDir = ".agent-video/out";
  const baseName = basename(file).replace(/\.json$/, "").replace(/\.spec$/, "");

  let aspectRatios: AspectRatio[] | undefined;
  if (typeof args.flags.aspect === "string") {
    const requested = args.flags.aspect.split(",").map((s) => s.trim());
    const bad = requested.filter((a) => !(VALID_ASPECTS as string[]).includes(a));
    if (bad.length) fail(`Invalid aspect ratio(s): ${bad.join(", ")}`, `Valid: ${VALID_ASPECTS.join(", ")}.`);
    aspectRatios = requested as AspectRatio[];
  }

  let result;
  try {
    result = await renderVideo(spec, { repoPath, outDir, baseName, aspectRatios });
  } catch (e) {
    fail(`Render failed: ${(e as Error).message}`, "Fix the spec/repo, then re-run preview.");
  }

  const videoId = specVideoId(spec);
  const port = typeof args.flags.port === "string" ? parseInt(args.flags.port, 10) : undefined;
  const handle = startPreviewServer({ outputs: result.outputs, title: spec.meta.title, videoId, port });

  // Agent-first: emit the result (stable watchUrl) immediately, then keep serving.
  process.stdout.write(
    JSON.stringify(
      { ok: true, videoId, status: "success", watchUrl: handle.watchUrl, url: handle.url, port: handle.port, outputs: result.outputs },
      null,
      2,
    ) + "\n",
  );

  const serveSeconds = typeof args.flags["serve-seconds"] === "string" ? parseInt(args.flags["serve-seconds"], 10) : undefined;
  if (serveSeconds && serveSeconds > 0) {
    await Bun.sleep(serveSeconds * 1000);
    handle.stop();
    process.exit(0);
  }
  await new Promise<void>(() => {}); // serve until killed
}

function cmdCapture(args: Args): never {
  const seconds = typeof args.flags.seconds === "string" ? parseInt(args.flags.seconds, 10) : 5;
  const fps = typeof args.flags.fps === "string" ? parseInt(args.flags.fps, 10) : 30;
  const repoRoot = typeof args.flags.repo === "string" ? args.flags.repo : ".";
  const id = typeof args.flags.id === "string" ? args.flags.id : `cap-${randomBytes(4).toString("hex")}`;
  ensureCapturesDir(repoRoot);
  const out = sessionPath(id, repoRoot);
  try {
    const r = recordScreen({ outPath: out, durationSec: seconds, fps });
    ok({ ok: true, sessionId: id, path: r.outPath, bytes: r.bytes, seconds, hint: `Reference it in a spec: { "kind": "screencap", "content": { "source": "desktop", "sessionRef": "${id}" } }` });
  } catch (e) {
    fail(`Capture failed: ${(e as Error).message}`, "Grant Screen Recording permission (System Settings → Privacy & Security → Screen Recording), then retry. macOS only.");
  }
}

async function cmdEval(args: Args): Promise<never> {
  const file = (typeof args.flags.spec === "string" ? args.flags.spec : undefined) ?? "examples/golden.spec.json";
  const { spec } = loadSpecOrFail(file, "Usage: agent-video eval [--spec PATH]");
  const repoPath = spec.meta.repo.path;

  // Provision synthetic capture sessions so screencap scenes render without
  // Screen Recording permission (the self-test is deterministic + offline).
  for (const s of spec.scenes) {
    if (s.kind === "screencap" && s.content.sessionRef) ensureSyntheticSession(s.content.sessionRef, repoPath);
  }

  let result;
  try {
    result = await renderVideo(spec, { repoPath, outDir: ".agent-video/eval", baseName: "eval", aspectRatios: ["16:9", "9:16"] });
  } catch (e) {
    fail(`Self-test render failed: ${(e as Error).message}`, "Fix the spec/repo and re-run `agent-video eval`.");
  }

  const ars = result.outputs.map((o) => o.aspectRatio);
  const gates: Record<string, boolean> = {
    rendersBothRatios: ars.includes("16:9") && ars.includes("9:16"),
    validMp4: result.outputs.length > 0 && result.outputs.every((o) => o.durationMs > 0),
    allKindsRendered: result.skipped.length === 0,
    refsReadLive: result.resolvedCode.length > 0,
    durationsSynced: result.scenes.filter((s) => s.auto).every((s) => Math.abs(s.durationSec - (s.narrationMs / 1000 + 0.6)) < 0.05),
  };
  const allPass = Object.values(gates).every(Boolean);
  const payload = {
    ok: allPass,
    gates,
    sceneKinds: [...new Set(spec.scenes.map((s) => s.kind))],
    outputs: result.outputs,
    resolvedRefs: result.resolvedCode.map((r) => ({ scene: r.scene, file: r.file })),
  };
  if (!allPass) fail("Self-test gates failed.", "See `gates` for which check failed.", payload);
  ok(payload);
}

function cmdSchema(): never {
  ok(videoSpecJsonSchema());
}

function cmdHelp(): never {
  // Human-readable to stderr so stdout stays JSON-clean for `--help` scrapers;
  // but help is the one place we print prose. Keep it example-rich (agent-first).
  process.stdout.write(
    `agent-video — Loom for agents. Author a spec.json; render a narrated video.

USAGE
  agent-video <command> [args] [--flags]

COMMANDS
  validate <spec.json>   Validate a spec against the contract. Structured JSON out;
                         errors include a 'hint' for each fix.
  render <spec.json>     Render the spec to mp4 (both ratios). Flags: --out DIR,
                         --repo PATH, --aspect 16:9,9:16, --frames-only
                         (--frames-only = PNG per scene, skips TTS + mux).
  preview <spec.json>    Render, then serve a localhost watch page. Returns a
                         stable watchUrl. Flags: --port N, --serve-seconds N.
  capture                Record the screen (macOS) into a capture session for a
                         screencap scene. Flags: --seconds N, --id NAME, --fps N.
  eval                   Self-test: render the golden example (or --spec PATH) in
                         both ratios and assert every gate. Returns pass/fail JSON.
  schema                 Print the published JSON Schema for spec.json.
  help                   Show this help.
  version                Print the version as JSON.

THE CONTRACT (author only this; never write ffmpeg or paste source)
  A spec.json is { "meta": {...}, "scenes": [ ... ] }.
  Scene kinds: title, code, diff, talking-points, chart, screencap.
  code/diff carry repo REFERENCES (file, lineStart/End, ref) — never pasted code.
  Every scene has "narration"; use "duration": "auto".
  Renderable now: ${IMPLEMENTED_SCENE_KINDS.join(", ")}.

EXAMPLES
  agent-video schema
  agent-video validate examples/hello.spec.json

  Minimal spec:
  {
    "meta": { "title": "Demo", "aspectRatios": ["16:9", "9:16"] },
    "scenes": [
      { "kind": "title", "content": { "heading": "Hello" }, "narration": "Hi.", "duration": "auto" },
      { "kind": "code", "content": { "file": "packages/core/src/spec.ts", "lineStart": 1, "lineEnd": 20 },
        "narration": "Here is the spec.", "duration": "auto" }
    ]
  }
`,
  );
  process.exit(0);
}

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------

async function main(): Promise<void> {
  const args = parseArgs(process.argv);

  if (args.flags.help || args.command === "help" || args.command === "--help" || args.command === "-h") {
    cmdHelp();
  }

  switch (args.command) {
    case "validate":
      cmdValidate(args);
      break;
    case "render":
      await cmdRender(args);
      break;
    case "preview":
      await cmdPreview(args);
      break;
    case "capture":
      cmdCapture(args);
      break;
    case "eval":
      await cmdEval(args);
      break;
    case "schema":
      cmdSchema();
      break;
    case "version":
    case "--version":
    case "-v":
      ok({ name: "agent-video", version: VERSION });
      break;
    default:
      fail(`Unknown command: '${args.command}'`, "Run `agent-video help`. Commands: validate, render, schema, help, version.");
  }
}

main().catch((e) => fail(e instanceof Error ? e.message : String(e)));
