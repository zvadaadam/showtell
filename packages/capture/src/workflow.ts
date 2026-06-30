import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { analyzeVisualActivity } from "./activity.ts";
import type { CaptureEvent, CaptureEventType } from "./camera.ts";
import { loadSessionEvents, normalizeCaptureEvents, writeSessionEvents } from "./events.ts";
import { importCaptureSession, resolveSession } from "./sessions.ts";
import {
  readExternalCaptureState,
  runCapturedCommand,
  runCommand,
  startExternalCaptureSession,
  stopExternalCaptureSession,
  type CommandResult,
  type ExternalCaptureState,
  type CapturedCommandResult,
} from "./external.ts";

export interface CaptureWorkflowError {
  ok: false;
  error: string;
  hint: string;
  sessionId?: string;
  exitCode?: number;
  stdout?: string;
  stderr?: string;
  timedOut?: boolean;
  event?: CaptureEvent;
  eventSource?: string;
  eventCount?: number;
  command?: CommandResult;
  state?: ExternalCaptureState;
}

export interface CaptureImportWorkflowResult {
  ok: true;
  sessionId: string;
  path: string;
  bytes: number;
  eventCount: number;
  hint: string;
}

export interface CaptureAnalyzeWorkflowResult {
  ok: true;
  sourcePath: string;
  sampleCount: number;
  sampleFps: number;
  intervalCount: number;
  intervals: ReturnType<typeof analyzeVisualActivity>["intervals"];
  suggestedEvents: ReturnType<typeof analyzeVisualActivity>["events"];
  hint: string;
}

export interface CaptureStartExternalWorkflowResult {
  ok: true;
  sessionId: string;
  state: ExternalCaptureState;
  command?: CommandResult;
  hint: string;
}

export interface CaptureExecWorkflowResult extends Omit<CapturedCommandResult, "command"> {
  ok: true;
  sessionId: string;
  eventCount: number;
  hint: string;
}

export interface CaptureStopExternalWorkflowResult {
  ok: true;
  sessionId: string;
  state: ExternalCaptureState;
  command?: CommandResult;
  imported?: { sessionId: string; path: string; bytes: number };
  eventCount: number;
  hint: string;
}

export function importCaptureWorkflow(opts: {
  id: string;
  sourcePath: string;
  root?: string;
  eventsPath?: string;
}): CaptureImportWorkflowResult {
  const root = opts.root ?? ".";
  const imported = importCaptureSession({ id: opts.id, sourcePath: opts.sourcePath, root });
  let eventCount = 0;
  if (opts.eventsPath) {
    const events = normalizeCaptureEvents(JSON.parse(readFileSync(opts.eventsPath, "utf-8")));
    writeSessionEvents(opts.id, root, events);
    eventCount = events.length;
  }
  return {
    ok: true,
    sessionId: imported.sessionId,
    path: imported.path,
    bytes: imported.bytes,
    eventCount,
    hint: `Reference it in a spec: { "kind": "screencap", "content": { "source": "browser", "sessionRef": "${opts.id}", "playback": { "mode": "smart" } } }`,
  };
}

export function analyzeCaptureWorkflow(opts: {
  id?: string;
  sourcePath?: string;
  root?: string;
  sourceStartSec?: number;
  sourceDurationSec?: number;
  sampleFps?: number;
  visualMinScore?: number;
}): CaptureAnalyzeWorkflowResult | CaptureWorkflowError {
  const root = opts.root ?? ".";
  const source = opts.sourcePath ?? (opts.id ? resolveSession(opts.id, root) : undefined);
  if (!source) {
    return {
      ok: false,
      error: "Missing capture source.",
      hint: "Pass sourcePath, or pass id/sessionId for a capture already imported into .agent-video/captures.",
    };
  }
  const result = analyzeVisualActivity({
    source,
    sourceStartSec: opts.sourceStartSec,
    sourceDurationSec: opts.sourceDurationSec,
    config: {
      sampleFps: opts.sampleFps,
      minScore: opts.visualMinScore,
    },
  });
  return {
    ok: true,
    sourcePath: source,
    sampleCount: result.sampleCount,
    sampleFps: result.sampleFps,
    intervalCount: result.intervals.length,
    intervals: result.intervals,
    suggestedEvents: result.events,
    hint: 'Use playback.mode="smart" to trim visually idle time.',
  };
}

export function startExternalCaptureWorkflow(opts: {
  id: string;
  sourcePath: string;
  root?: string;
  driver?: string;
  command?: string[];
  timeoutMs?: number;
}): CaptureStartExternalWorkflowResult | CaptureWorkflowError {
  const root = opts.root ?? ".";
  const command = opts.command ?? [];
  let commandResult: CommandResult | undefined;
  if (command.length > 0) {
    commandResult = runCommand(command, { cwd: resolve(root), timeoutMs: opts.timeoutMs });
    if (commandResult.exitCode !== 0) {
      return {
        ok: false,
        error: "External record-start command failed.",
        hint: "Fix the command and retry; no capture state was written.",
        command: commandResult,
      };
    }
  }
  const startedAtEpochMs = Date.now();
  const state = startExternalCaptureSession({
    id: opts.id,
    sourcePath: opts.sourcePath,
    root,
    driver: opts.driver,
    startedAtEpochMs,
  });
  return {
    ok: true,
    sessionId: opts.id,
    state,
    command: commandResult,
    hint: 'Run actions through the capture exec workflow, then stop the external capture and render with playback.mode="smart".',
  };
}

export function execCapturedCommandWorkflow(opts: {
  id: string;
  root?: string;
  command: string[];
  eventType?: CaptureEventType | "auto" | "none";
  x?: number;
  y?: number;
  startedAtEpochMs?: number;
  timeoutMs?: number;
}): CaptureExecWorkflowResult | CaptureWorkflowError {
  const root = opts.root ?? ".";
  const result = runCapturedCommand({
    id: opts.id,
    root,
    command: opts.command,
    cwd: resolve(root),
    eventType: opts.eventType,
    x: opts.x,
    y: opts.y,
    startedAtEpochMs: opts.startedAtEpochMs,
    timeoutMs: opts.timeoutMs,
  });
  const eventCount = loadSessionEvents(opts.id, root)?.length ?? 0;
  if (result.exitCode !== 0) {
    return {
      ok: false,
      error: "Captured command failed.",
      hint: "The command's stdout/stderr are included; fix it and retry.",
      sessionId: opts.id,
      exitCode: result.exitCode,
      stdout: result.stdout,
      stderr: result.stderr,
      timedOut: result.timedOut,
      event: result.event,
      eventSource: result.eventSource,
      eventCount,
      command: result,
    };
  }
  return {
    ok: true,
    sessionId: opts.id,
    exitCode: result.exitCode,
    stdout: result.stdout,
    stderr: result.stderr,
    timedOut: result.timedOut,
    event: result.event,
    eventSource: result.eventSource,
    eventCount,
    hint: result.event
      ? 'Event window recorded. Render with playback.mode="smart" so visual activity can place the cue precisely.'
      : 'No event inferred/recorded; playback.mode="smart" can still trim visually idle time.',
  };
}

export function stopExternalCaptureWorkflow(opts: {
  id: string;
  root?: string;
  command?: string[];
  noImport?: boolean;
  timeoutMs?: number;
}): CaptureStopExternalWorkflowResult | CaptureWorkflowError {
  const root = opts.root ?? ".";
  const command = opts.command ?? [];
  let commandResult: CommandResult | undefined;
  if (command.length > 0) {
    commandResult = runCommand(command, { cwd: resolve(root), timeoutMs: opts.timeoutMs });
    if (commandResult.exitCode !== 0) {
      return {
        ok: false,
        error: "External record-stop command failed.",
        hint: "Fix the command and retry; capture state was not stopped.",
        command: commandResult,
      };
    }
  }
  try {
    const state = stopExternalCaptureSession({ id: opts.id, root });
    const imported = opts.noImport
      ? undefined
      : importCaptureSession({ id: opts.id, sourcePath: state.sourcePath, root });
    return {
      ok: true,
      sessionId: opts.id,
      state,
      command: commandResult,
      imported,
      eventCount: loadSessionEvents(opts.id, root)?.length ?? 0,
      hint: `Reference this in a screencap scene with sessionRef "${opts.id}" and playback.mode "smart".`,
    };
  } catch (e) {
    return {
      ok: false,
      error: `Capture stop-external failed: ${(e as Error).message}`,
      state: readExternalCaptureState(opts.id, root) ?? undefined,
      hint: "Ensure the raw recording exists and retry.",
    };
  }
}
