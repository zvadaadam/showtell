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
import { randomBytes } from "node:crypto";
import {
  validateSpec,
  videoSpecJsonSchema,
  bundleSpecJsonSchema,
  validateBundle,
  IMPLEMENTED_SCENE_KINDS,
  specContentId,
  bundleHyperframeFile,
  effectiveBeats,
  loadHyperframeContractFromSource,
  themePresetManifest,
  type VideoSpec,
  type AspectRatio,
  type SpecError,
} from "@agent-video/core";
import {
  renderFrames,
  renderVideo,
  startPreviewServer,
  resolvePlayerDist,
  compileBundle,
  renderBundle,
  BundleCompileError,
  renderBundleWorkshop,
  renderWorkshop,
  startWorkshopServer,
} from "@agent-video/render";
import { hyperframeComponents, hyperframeTemplates } from "@agent-video/hyperframes";
import {
  recordScreen,
  ensureCapturesDir,
  sessionPath,
  ensureSyntheticSession,
  normalizeCaptureEvents,
  recordCaptureEvent,
  loadSessionEvents,
  analyzeCaptureWorkflow,
  execCapturedCommandWorkflow,
  importCaptureWorkflow,
  startExternalCaptureWorkflow,
  stopExternalCaptureWorkflow,
  type CaptureEventType,
} from "@agent-video/capture";

import cliManifest from "../package.json" with { type: "json" };

const VERSION: string = cliManifest.version;
const BOOLEAN_FLAGS = new Set(["frames-only", "no-import", "help", "stills"]);

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

function finish<T extends { ok: boolean; error?: string; hint?: string }>(result: T): never {
  if (result.ok) ok(result as Record<string, unknown>);
  const { ok: _ok, error, hint, ...extra } = result;
  fail(error ?? "Command failed.", hint, extra as Record<string, unknown>);
}

// ---------------------------------------------------------------------------
// Minimal arg parsing (no deps)
// ---------------------------------------------------------------------------

interface Args {
  command: string;
  positional: string[];
  flags: Record<string, string | boolean>;
  commandTail: string[];
}

function parseArgs(argv: string[]): Args {
  const args = argv.slice(2);
  const command = args[0] ?? "help";
  const positional: string[] = [];
  const flags: Record<string, string | boolean> = {};
  const commandTail: string[] = [];
  for (let i = 1; i < args.length; i++) {
    const a = args[i]!;
    if (a === "--") {
      commandTail.push(...args.slice(i + 1));
      break;
    }
    if (a.startsWith("--")) {
      const raw = a.slice(2);
      const eq = raw.indexOf("=");
      if (eq !== -1) {
        flags[raw.slice(0, eq)] = raw.slice(eq + 1);
      } else if (BOOLEAN_FLAGS.has(raw)) {
        flags[raw] = true;
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
  return { command, positional, flags, commandTail };
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
    fail(
      `Invalid JSON in ${file}: ${(e as Error).message}`,
      "Fix the JSON syntax (e.g. trailing commas, unquoted keys).",
    );
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

function parseAspectRatios(args: Args): AspectRatio[] | undefined {
  if (typeof args.flags.aspect !== "string") return undefined;
  const requested = args.flags.aspect.split(",").map((s) => s.trim());
  const bad = requested.filter((a) => !(VALID_ASPECTS as string[]).includes(a));
  if (bad.length) fail(`Invalid aspect ratio(s): ${bad.join(", ")}`, `Valid: ${VALID_ASPECTS.join(", ")}.`);
  return requested as AspectRatio[];
}

async function cmdRender(args: Args): Promise<never> {
  const usage = "Usage: agent-video render <spec.json> [--out DIR] [--repo PATH] [--aspect 16:9,9:16] [--frames-only]";
  const file = args.positional[0]!;
  const { spec } = loadSpecOrFail(file, usage);

  const repoPath = (typeof args.flags.repo === "string" ? args.flags.repo : undefined) ?? spec.meta.repo.path;
  const framesOnly = flagEnabled(args.flags["frames-only"]);
  const outDir =
    (typeof args.flags.out === "string" ? args.flags.out : undefined) ??
    (framesOnly ? ".agent-video/frames" : ".agent-video/out");

  const aspectRatios = parseAspectRatios(args);

  try {
    if (framesOnly) {
      const result = await renderFrames(spec, { repoPath, outDir, aspectRatios });
      ok({
        ok: true,
        stage: "frames",
        outDir: result.outDir,
        frameCount: result.frames.length,
        frames: result.frames,
        resolvedCode: result.resolvedCode,
        skipped: result.skipped,
      });
    }
    const baseName = basename(file)
      .replace(/\.json$/, "")
      .replace(/\.spec$/, "");
    const result = await renderVideo(spec, { repoPath, outDir, baseName, aspectRatios });
    ok({
      ok: true,
      stage: "video",
      outDir,
      manifestPath: result.manifestPath,
      durationSec: result.manifest.durationSec,
      outputs: result.outputs,
      scenes: result.scenes,
      resolvedCode: result.resolvedCode,
      skipped: result.skipped,
      warnings: result.warnings,
    });
  } catch (e) {
    fail(
      `Render failed: ${(e as Error).message}`,
      "Check the failing scene's file/line reference, the repo path, and that ffmpeg is installed.",
    );
  }
}

function flagEnabled(value: string | boolean | undefined): boolean {
  return value === true || value === "true" || value === "1" || value === "yes";
}

function stringFlag(flags: Record<string, string | boolean>, name: string): string | undefined {
  return typeof flags[name] === "string" ? flags[name] : undefined;
}

function numberFlag(flags: Record<string, string | boolean>, name: string): number | undefined {
  const raw = stringFlag(flags, name);
  if (raw === undefined) return undefined;
  const n = Number(raw);
  if (!Number.isFinite(n)) fail(`Invalid --${name}: ${raw}`, `Pass --${name} as a number.`);
  return n;
}

function integerFlag(flags: Record<string, string | boolean>, name: string): number | undefined {
  const n = numberFlag(flags, name);
  if (n !== undefined && !Number.isInteger(n)) fail(`Invalid --${name}: ${n}`, `Pass --${name} as an integer.`);
  return n;
}

async function emitAndServe(
  payload: Record<string, unknown>,
  handle: { stop(): void },
  serveSeconds: number | undefined,
): Promise<never> {
  process.stdout.write(JSON.stringify(payload, null, 2) + "\n");
  if (serveSeconds && serveSeconds > 0) {
    await Bun.sleep(serveSeconds * 1000);
    handle.stop();
    process.exit(0);
  }
  return new Promise<never>(() => {}); // serve until killed
}

async function cmdPreview(args: Args): Promise<void> {
  const usage =
    "Usage: agent-video preview <spec.json> [--port N] [--repo PATH] [--aspect 16:9,9:16] [--serve-seconds N]";
  const file = args.positional[0]!;
  const { spec } = loadSpecOrFail(file, usage);
  const repoPath = (typeof args.flags.repo === "string" ? args.flags.repo : undefined) ?? spec.meta.repo.path;
  const outDir = ".agent-video/out";
  const baseName = basename(file)
    .replace(/\.json$/, "")
    .replace(/\.spec$/, "");

  const aspectRatios = parseAspectRatios(args);
  const port = integerFlag(args.flags, "port");
  const serveSeconds = integerFlag(args.flags, "serve-seconds");

  let playerDir: string;
  try {
    playerDir = resolvePlayerDist();
  } catch (e) {
    fail((e as Error).message, "Build the player once, then re-run preview.");
  }

  let result;
  try {
    result = await renderVideo(spec, { repoPath, outDir, baseName, aspectRatios });
  } catch (e) {
    fail(`Render failed: ${(e as Error).message}`, "Fix the spec/repo, then re-run preview.");
  }

  const videoId = specContentId(spec);
  const handle = startPreviewServer({ bundleDir: outDir, playerDir, title: spec.meta.title, videoId, port });

  // Agent-first: emit the result (stable watchUrl) immediately, then keep serving.
  await emitAndServe(
    {
      ok: true,
      videoId,
      status: "success",
      watchUrl: handle.watchUrl,
      url: handle.url,
      port: handle.port,
      manifestPath: result.manifestPath,
      outputs: result.outputs,
    },
    handle,
    serveSeconds,
  );
}

function cmdCapture(args: Args): never {
  const subcommand = args.positional[0];
  if (subcommand === "import") return cmdCaptureImport(args);
  if (subcommand === "event") return cmdCaptureEvent(args);
  if (subcommand === "analyze") return cmdCaptureAnalyze(args);
  if (subcommand === "start-external") return cmdCaptureStartExternal(args);
  if (subcommand === "exec") return cmdCaptureExec(args);
  if (subcommand === "stop-external") return cmdCaptureStopExternal(args);
  if (subcommand) {
    fail(
      `Unknown capture subcommand: ${subcommand}`,
      "Use `agent-video capture` to record, import, analyze, start-external, exec, stop-external, or event.",
    );
  }

  const seconds = numberFlag(args.flags, "seconds") ?? 5;
  const fps = numberFlag(args.flags, "fps") ?? 30;
  const repoRoot = stringFlag(args.flags, "repo") ?? ".";
  const id = stringFlag(args.flags, "id") ?? `cap-${randomBytes(4).toString("hex")}`;
  ensureCapturesDir(repoRoot);
  const out = sessionPath(id, repoRoot);
  try {
    const r = recordScreen({ outPath: out, durationSec: seconds, fps });
    ok({
      ok: true,
      sessionId: id,
      path: r.outPath,
      bytes: r.bytes,
      seconds,
      hint: `Reference it in a spec: { "kind": "screencap", "content": { "source": "desktop", "sessionRef": "${id}" } }`,
    });
  } catch (e) {
    fail(
      `Capture failed: ${(e as Error).message}`,
      "Grant Screen Recording permission (System Settings → Privacy & Security → Screen Recording), then retry. macOS only.",
    );
  }
}

function cmdCaptureImport(args: Args): never {
  const source = args.positional[1] ?? stringFlag(args.flags, "file") ?? stringFlag(args.flags, "source");
  if (!source) {
    fail(
      "Missing capture source file.",
      "Usage: agent-video capture import <recording.webm|mp4> --id NAME [--events events.json] [--repo PATH]",
    );
  }
  const repoRoot = stringFlag(args.flags, "repo") ?? ".";
  const id = stringFlag(args.flags, "id") ?? `cap-${randomBytes(4).toString("hex")}`;
  try {
    finish(
      importCaptureWorkflow({ id, sourcePath: source, root: repoRoot, eventsPath: stringFlag(args.flags, "events") }),
    );
  } catch (e) {
    fail(
      `Capture import failed: ${(e as Error).message}`,
      "Pass a readable browser recording (agent-browser writes .webm) and optional events JSON shaped as [{t,type,x,y}].",
    );
  }
}

function cmdCaptureEvent(args: Args): never {
  const id = stringFlag(args.flags, "id");
  if (!id) fail("Missing --id.", "Usage: agent-video capture event --id NAME --type click --x 100 --y 200 --t-ms 1234");
  const type = stringFlag(args.flags, "type");
  const x = numberFlag(args.flags, "x");
  const y = numberFlag(args.flags, "y");
  const t = numberFlag(args.flags, "t-ms") ?? numberFlag(args.flags, "t");
  if (!type || x === undefined || y === undefined || t === undefined) {
    fail("Missing event field.", "Pass all event fields: --type click --x N --y N --t-ms N.");
  }
  const repoRoot = stringFlag(args.flags, "repo") ?? ".";
  try {
    const event = normalizeCaptureEvents([{ type, x, y, t }])[0]!;
    recordCaptureEvent(id, repoRoot, event);
    ok({
      ok: true,
      sessionId: id,
      event,
      eventCount: loadSessionEvents(id, repoRoot)?.length ?? 0,
      hint: `Use playback.mode="smart" in a screencap scene to combine events with visual idle trimming.`,
    });
  } catch (e) {
    fail(
      `Capture event failed: ${(e as Error).message}`,
      "Use --type click|type|scroll|navigate|idle and numeric --x/--y/--t-ms values.",
    );
  }
}

function cmdCaptureAnalyze(args: Args): never {
  const repoRoot = stringFlag(args.flags, "repo") ?? ".";
  const id = stringFlag(args.flags, "id");
  try {
    finish(
      analyzeCaptureWorkflow({
        id,
        sourcePath: args.positional[1] ?? stringFlag(args.flags, "source"),
        root: repoRoot,
        sourceStartSec: numberFlag(args.flags, "source-start-sec"),
        sourceDurationSec: numberFlag(args.flags, "source-duration-sec"),
        sampleFps: numberFlag(args.flags, "sample-fps"),
        visualMinScore: numberFlag(args.flags, "visual-min-score"),
      }),
    );
  } catch (e) {
    fail(`Capture analyze failed: ${(e as Error).message}`, "Check that ffmpeg can decode the capture source.");
  }
}

function cmdCaptureStartExternal(args: Args): never {
  const repoRoot = stringFlag(args.flags, "repo") ?? ".";
  const id = stringFlag(args.flags, "id");
  if (!id)
    fail(
      "Missing --id.",
      "Usage: agent-video capture start-external <raw.webm|mp4> --id NAME -- <record-start command>",
    );
  const sourcePath = args.positional[1] ?? stringFlag(args.flags, "source");
  if (!sourcePath) {
    fail(
      "Missing external recording source path.",
      "Usage: agent-video capture start-external <raw.webm|mp4> --id NAME -- <record-start command>",
    );
  }
  try {
    finish(
      startExternalCaptureWorkflow({
        id,
        sourcePath,
        root: repoRoot,
        driver: stringFlag(args.flags, "driver"),
        command: args.commandTail,
        timeoutMs: numberFlag(args.flags, "timeout-ms"),
      }),
    );
  } catch (e) {
    fail(`Capture start-external failed: ${(e as Error).message}`, "Use a valid --id and pass the raw recording path.");
  }
}

function cmdCaptureExec(args: Args): never {
  const repoRoot = stringFlag(args.flags, "repo") ?? ".";
  const id = stringFlag(args.flags, "id");
  if (!id) fail("Missing --id.", "Usage: agent-video capture exec --id NAME -- <tool command>");
  const eventType = captureEventTypeFlag(args.flags, "event-type") ?? "auto";
  try {
    finish(
      execCapturedCommandWorkflow({
        id,
        root: repoRoot,
        command: args.commandTail,
        eventType,
        x: numberFlag(args.flags, "x"),
        y: numberFlag(args.flags, "y"),
        startedAtEpochMs: numberFlag(args.flags, "started-at-epoch-ms"),
        timeoutMs: numberFlag(args.flags, "timeout-ms"),
      }),
    );
  } catch (e) {
    fail(
      `Capture exec failed: ${(e as Error).message}`,
      "Run capture start-external first, or pass --event-type click --x N --y N for tools that cannot be inferred.",
    );
  }
}

function cmdCaptureStopExternal(args: Args): never {
  const repoRoot = stringFlag(args.flags, "repo") ?? ".";
  const id = stringFlag(args.flags, "id");
  if (!id) fail("Missing --id.", "Usage: agent-video capture stop-external --id NAME -- <record-stop command>");
  try {
    finish(
      stopExternalCaptureWorkflow({
        id,
        root: repoRoot,
        command: args.commandTail,
        noImport: flagEnabled(args.flags["no-import"]),
        timeoutMs: numberFlag(args.flags, "timeout-ms"),
      }),
    );
  } catch (e) {
    fail(`Capture stop-external failed: ${(e as Error).message}`, "Ensure the raw recording exists, then retry.");
  }
}

function captureEventTypeFlag(
  flags: Record<string, string | boolean>,
  name: string,
): CaptureEventType | "auto" | "none" | undefined {
  const raw = stringFlag(flags, name);
  if (!raw) return undefined;
  if (raw === "auto" || raw === "none") return raw;
  if (["click", "type", "scroll", "navigate", "idle"].includes(raw)) return raw as CaptureEventType;
  fail(`Invalid --${name}: ${raw}`, "Use auto, none, click, type, scroll, navigate, or idle.");
}

async function cmdBundle(args: Args): Promise<never> {
  const subcommand = args.positional[0] ?? "help";
  const bundleDir = args.positional[1];

  if (subcommand === "schema") {
    ok(bundleSpecJsonSchema());
  }
  if (subcommand === "help" || args.flags.help) {
    ok({
      ok: true,
      usage:
        "agent-video bundle <validate|inspect|compile|render|workshop|components|templates|themes|schema> <bundle-dir> [--out DIR] [--aspect 16:9,9:16]",
      examples: [
        "agent-video bundle validate examples/bundle-v2",
        "agent-video bundle inspect examples/bundle-v2",
        "agent-video bundle components",
        "agent-video bundle themes",
        "agent-video bundle templates",
        "agent-video bundle workshop examples/bundle-v2 --out .agent-video/workshop --aspect 16:9",
        "agent-video bundle compile examples/bundle-v2",
        "agent-video bundle render examples/bundle-v2 --out .agent-video/bundle-v2 --aspect 16:9",
      ],
    });
  }
  if (subcommand === "templates") {
    ok({
      ok: true,
      stage: "bundle-templates",
      package: "@agent-video/hyperframes",
      templates: hyperframeTemplates,
      usage:
        "Use templates as complete examples. Prefer reusable components for common patterns; run `agent-video bundle components`.",
    });
  }
  if (subcommand === "themes") {
    ok({
      ok: true,
      stage: "bundle-themes",
      themes: themePresetManifest(),
      usage:
        'Pick a preset by mood and set meta.theme = { "preset": "<id>" }; optionally override colors (e.g. brand accent) or typography. Presets already pass the contrast gates; overrides are re-validated.',
    });
  }
  if (subcommand === "components") {
    ok({
      ok: true,
      stage: "bundle-components",
      package: "@agent-video/hyperframes",
      components: hyperframeComponents,
      usage:
        'Import components from "@agent-video/hyperframes" inside hyperframes/*.tsx; use the requiredProps/commonProps/example fields, then compose with ctx.props, ctx.repo(), ctx.asset(), ctx.range(), and ctx.scene.lineIndex.',
    });
  }

  if (!bundleDir) {
    fail(
      "Missing bundle directory.",
      "Usage: agent-video bundle <validate|inspect|compile|render|workshop|components|templates|themes|schema> <bundle-dir> [--out DIR] [--aspect 16:9,9:16]",
    );
  }

  if (subcommand === "validate") {
    const result = validateBundle(bundleDir);
    if (!result.ok) {
      fail("Bundle failed validation.", "Fix each error below; then re-run bundle validate.", {
        errors: result.errors,
        warnings: result.warnings,
      });
    }
    ok({
      ok: true,
      stage: "bundle-validate",
      bundleDir: result.bundleDir,
      repoPath: result.repoPath,
      sceneCount: result.spec.scenes.length,
      assetCount: Object.keys(result.spec.assets).length,
      hyperframes: result.spec.scenes
        .filter((scene) => scene.visual.kind === "hyperframe")
        .map((scene) => ({ scene: scene.id, src: scene.visual.kind === "hyperframe" ? scene.visual.src : undefined })),
      warnings: result.warnings,
    });
  }

  if (subcommand === "inspect") {
    const result = validateBundle(bundleDir);
    if (!result.ok) {
      fail("Bundle failed validation.", "Fix each error below; then re-run bundle inspect.", {
        errors: result.errors,
        warnings: result.warnings,
      });
    }
    ok({
      ok: true,
      stage: "bundle-inspect",
      bundleDir: result.bundleDir,
      repoPath: result.repoPath,
      meta: {
        title: result.spec.meta.title,
        fps: result.spec.meta.fps,
        aspectRatios: result.spec.meta.aspectRatios,
      },
      assets: Object.entries(result.spec.assets).map(([id, asset]) => ({
        id,
        type: asset.type,
        src: asset.src,
      })),
      scenes: result.spec.scenes.map((scene, index) => ({
        index,
        id: scene.id,
        narrationLines: scene.narration.lines.map((line) => ({
          id: line.id,
          text: line.text,
        })),
        beats: {
          source: scene.beats.length ? "authored" : "implicit-per-line",
          items: effectiveBeats(scene),
        },
        refs: Object.entries(scene.refs).map(([id, ref]) => ({
          id,
          kind: ref.kind,
          file: ref.file,
        })),
        ranges: scene.ranges,
        visual:
          scene.visual.kind === "hyperframe"
            ? inspectHyperframeVisual(bundleDir, scene.visual)
            : {
                kind: scene.visual.kind,
                name: scene.visual.name,
                ref: scene.visual.ref,
                propsKeys: Object.keys(scene.visual.props),
              },
      })),
      warnings: result.warnings,
    });
  }

  const aspectRatios = parseAspectRatios(args);
  const outDir = typeof args.flags.out === "string" ? args.flags.out : undefined;
  const cacheDir = typeof args.flags.cache === "string" ? args.flags.cache : undefined;
  try {
    if (subcommand === "compile") {
      const result = await compileBundle(bundleDir, { cacheDir });
      ok({
        ok: true,
        stage: "bundle-compile",
        planPath: result.planPath,
        durationMs: result.plan.meta.durationMs,
        sceneCount: result.plan.meta.sceneCount,
        assetCount: Object.keys(result.plan.assets).length,
        musicCount: result.plan.audio.music.length,
        refs: result.plan.scenes.flatMap((scene) =>
          Object.entries(scene.refs).map(([id, ref]) => ({ scene: scene.id, id, kind: ref.kind, file: ref.file })),
        ),
        warnings: result.warnings,
      });
    }
    if (subcommand === "render") {
      const result = await renderBundle(bundleDir, {
        outDir,
        aspectRatios,
        cacheDir,
        motion: args.flags.stills !== true,
      });
      ok({
        ok: true,
        stage: "bundle-render",
        outDir: result.outDir,
        planPath: result.planPath,
        durationMs: result.plan.meta.durationMs,
        outputs: result.outputs,
        resolvedCode: result.resolvedCode,
        warnings: result.warnings,
      });
    }
    if (subcommand === "workshop") {
      const serveSeconds = integerFlag(args.flags, "serve-seconds");
      const result = await renderBundleWorkshop(bundleDir, { outDir, aspectRatios });
      if (serveSeconds !== undefined) {
        const handle = startWorkshopServer({ outDir: result.outDir });
        await emitAndServe(
          {
            ...result,
            url: handle.url,
            port: handle.port,
          },
          handle,
          serveSeconds,
        );
      }
      ok(result as unknown as Record<string, unknown>);
    }
  } catch (e) {
    if (e instanceof BundleCompileError) {
      fail(e.message, "Fix each bundle error below; then re-run the command.", {
        errors: e.errors,
        warnings: e.warnings,
      });
    }
    fail(
      `Bundle ${subcommand} failed: ${(e as Error).message}`,
      "Run `agent-video bundle validate <bundle-dir>` first, then check ffmpeg/TTS prerequisites.",
    );
  }

  fail(
    `Unknown bundle command: '${subcommand}'`,
    "Run `agent-video bundle help`. Commands: validate, inspect, compile, render, workshop, components, templates, themes, schema.",
  );
}

async function cmdWorkshop(args: Args): Promise<never> {
  const subcommand = args.positional[0] ?? "render";
  const aspectRatios = parseAspectRatios(args);
  const outDir = typeof args.flags.out === "string" ? args.flags.out : undefined;
  if (subcommand !== "render") {
    fail(
      "Unknown workshop command.",
      "Usage: agent-video workshop render [--out DIR] [--aspect 16:9,9:16] [--serve-seconds N]",
    );
  }
  const serveSeconds = integerFlag(args.flags, "serve-seconds");
  const result = await renderWorkshop({ outDir, aspectRatios });
  if (serveSeconds !== undefined) {
    const handle = startWorkshopServer({ outDir: result.outDir });
    await emitAndServe({ ...result, url: handle.url, port: handle.port }, handle, serveSeconds);
  }
  ok(result as unknown as Record<string, unknown>);
}

function inspectHyperframeVisual(
  bundleDir: string,
  visual: {
    kind: "hyperframe";
    src: string;
    export: "default";
    props: Record<string, unknown>;
    inputs: Record<string, unknown>;
  },
): Record<string, unknown> {
  const source = readFileSync(bundleHyperframeFile(bundleDir, visual.src).path, "utf-8");
  const contract = loadHyperframeContractFromSource(source);
  return {
    kind: "hyperframe",
    src: visual.src,
    export: visual.export,
    sourceSha256: contract.sourceSha256,
    propsKeys: Object.keys(visual.props),
    propsSchema: contract.propsSchema,
    inputs: Object.entries(contract.inputs).map(([name, input]) => ({
      name,
      kind: input.kind,
      optional: input.optional,
      required: !input.optional,
      refKind: input.kind === "repo" ? input.refKind : undefined,
      assetType: input.kind === "asset" ? input.assetType : undefined,
      value: visual.inputs[name] ?? null,
    })),
  };
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
    result = await renderVideo(spec, {
      repoPath,
      outDir: ".agent-video/eval",
      baseName: "eval",
      aspectRatios: ["16:9", "9:16"],
    });
  } catch (e) {
    fail(`Self-test render failed: ${(e as Error).message}`, "Fix the spec/repo and re-run `agent-video eval`.");
  }

  const ars = result.outputs.map((o) => o.aspectRatio);
  const gates: Record<string, boolean> = {
    rendersBothRatios: ars.includes("16:9") && ars.includes("9:16"),
    validMp4: result.outputs.length > 0 && result.outputs.every((o) => o.durationMs > 0),
    allKindsRendered: result.skipped.length === 0,
    refsReadLive: result.resolvedCode.length > 0,
    durationsSynced: result.scenes
      .filter((s) => s.auto)
      .every((s) => Math.abs(s.durationSec - (s.narrationMs / 1000 + 0.6)) < 0.05),
    manifestEmitted: result.manifest.version === 1 && result.manifest.scenes.length === result.scenes.length,
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
  // Human-readable to stdout. Keep it example-rich (agent-first).
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
  preview <spec.json>    Render, then serve the web player at a localhost watch
                         URL (the bundle is served too). Flags: --port N,
                         --serve-seconds N. (Build the player once first.)
  capture                Record the screen (macOS) into a capture session for a
                         screencap scene. Flags: --seconds N, --id NAME, --fps N.
  capture import <file>  Import an agent-browser .webm/mp4 into a sandboxed
                         capture session. Flags: --id NAME, --events events.json.
  capture analyze        Inspect visual activity in a capture. Flags:
                         --id NAME or <file>, --sample-fps N.
  capture event          Append one action event to a session sidecar. Flags:
                         --id NAME, --type click|type|scroll|navigate|idle,
                         --x N, --y N, --t-ms N.
  capture start-external Start tracking an external recorder. Example:
                         capture start-external ./demo.webm --id demo --
                           agent-browser record start ./demo.webm
  capture exec           Run a real CLI action and record an event window if inferred.
                         Example: capture exec --id demo -- agent-browser click @e3
                         For generic tools: --event-type click --x N --y N.
  capture stop-external  Stop external tracking, optionally running a stop command,
                         then import the raw recording. Example:
                         capture stop-external --id demo -- agent-browser record stop
  bundle validate DIR    Validate a v2 bundle directory (spec.json + assets +
                         hyperframes). Structured errors include hints.
  bundle inspect DIR     Print scenes, refs, ranges, hyperframe ports, props
                         schemas, and warnings for agent planning.
  bundle templates       List reusable hyperframe starter templates from
                         @agent-video/hyperframes.
  bundle components      List reusable hyperframe components from
                         @agent-video/hyperframes.
  bundle themes          List theme presets (colors, typography, guidance) for
                         meta.theme.
  bundle workshop DIR    Render every bundle scene/line/aspect as PNGs in a
                         static workshop gallery. Flags: --out DIR, --aspect,
                         --serve-seconds N.
  bundle compile DIR     TTS + measure + resolve refs/assets/ranges, then write
                         compiled-plan.json. Flags: --cache DIR.
  bundle render DIR      Compile and render the v2 bundle to MP4. Hyperframe
                         scenes render per-frame with motion; pass --stills to
                         hold one frame per line. Flags: --out DIR,
                         --aspect 16:9,9:16, --cache DIR, --stills.
  workshop render        Render the built-in component workshop gallery.
                         Flags: --out DIR, --aspect 16:9,9:16,
                         --serve-seconds N.
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
  agent-video capture start-external ./demo.webm --id demo -- agent-browser record start ./demo.webm
  agent-video capture exec --id demo -- agent-browser click @submit
  agent-video capture stop-external --id demo -- agent-browser record stop
  agent-video capture analyze --id demo
  agent-video bundle components
  agent-video bundle workshop examples/bundle-v2 --out .agent-video/workshop --aspect 16:9
  agent-video bundle render examples/bundle-v2 --out .agent-video/bundle-v2 --aspect 16:9

  Minimal spec:
  {
    "meta": { "title": "Demo", "aspectRatios": ["16:9", "9:16"] },
    "scenes": [
      { "kind": "title", "content": { "heading": "Hello" }, "narration": "Hi.", "duration": "auto" },
      { "kind": "code", "content": { "file": "packages/core/src/spec.ts", "lineStart": 1, "lineEnd": 20 },
        "narration": "Here is the spec.", "duration": "auto" },
      { "kind": "screencap", "content": { "source": "browser", "sessionRef": "demo",
        "playback": { "mode": "smart" } }, "narration": "Only the useful action is shown.", "duration": "auto" }
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
    case "bundle":
      await cmdBundle(args);
      break;
    case "workshop":
      await cmdWorkshop(args);
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
      fail(
        `Unknown command: '${args.command}'`,
        "Run `agent-video help`. Commands: validate, render, preview, capture, bundle, workshop, eval, schema, help, version.",
      );
  }
}

main().catch((e) => fail(e instanceof Error ? e.message : String(e)));
