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
import { validateSpec, videoSpecJsonSchema, IMPLEMENTED_SCENE_KINDS } from "@agent-video/core";

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

function cmdValidate(args: Args): never {
  const file = args.positional[0];
  if (!file) {
    fail("Missing spec file.", "Usage: agent-video validate <spec.json>");
  }
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

  ok({
    ok: true,
    file,
    sceneCount: result.spec.scenes.length,
    kinds: result.spec.scenes.map((s) => s.kind),
    aspectRatios: result.spec.meta.aspectRatios,
    renderableNow: IMPLEMENTED_SCENE_KINDS,
    warnings: result.warnings,
  });
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
  schema                 Print the published JSON Schema for spec.json.
  help                   Show this help.
  version                Print the version as JSON.

  (coming next: render, preview, capture, eval)

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

const args = parseArgs(process.argv);

if (args.flags.help || args.command === "help" || args.command === "--help" || args.command === "-h") {
  cmdHelp();
}

switch (args.command) {
  case "validate":
    cmdValidate(args);
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
    fail(`Unknown command: '${args.command}'`, "Run `agent-video help`. Commands: validate, schema, help, version.");
}
