import { execFileSync, spawnSync } from "node:child_process";
import { basename, isAbsolute, resolve } from "node:path";
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { ensureCapturesDir, sessionPath, assertValidSessionId } from "./sessions.ts";
import { normalizeCaptureEvents, recordCaptureEvent } from "./events.ts";
import type { CaptureEvent, CaptureEventType } from "./camera.ts";

export interface ExternalCaptureState {
  sessionId: string;
  sourcePath: string;
  startedAtEpochMs: number;
  driver?: string;
  stoppedAtEpochMs?: number;
}

export interface CommandResult {
  command: string[];
  exitCode: number;
  stdout: string;
  stderr: string;
  timedOut?: boolean;
}

export interface CapturedCommandResult extends CommandResult {
  event?: CaptureEvent;
  eventSource?: string;
}

const DEFAULT_COMMAND_TIMEOUT_MS = 120_000;

export function externalStatePath(id: string, root = "."): string {
  assertValidSessionId(id);
  return sessionPath(id, root).replace(/\.mp4$/, ".session.json");
}

export function writeExternalCaptureState(id: string, root: string, state: ExternalCaptureState): void {
  ensureCapturesDir(root);
  writeFileSync(externalStatePath(id, root), JSON.stringify(state, null, 2) + "\n");
}

export function readExternalCaptureState(id: string, root = "."): ExternalCaptureState | null {
  const path = externalStatePath(id, root);
  if (!existsSync(path)) return null;
  const data = JSON.parse(readFileSync(path, "utf-8")) as ExternalCaptureState;
  if (data.sessionId !== id) throw new Error(`External capture state mismatch: expected ${id}, got ${data.sessionId}`);
  return data;
}

export function startExternalCaptureSession(opts: {
  id: string;
  sourcePath: string;
  root?: string;
  driver?: string;
  startedAtEpochMs?: number;
}): ExternalCaptureState {
  assertValidSessionId(opts.id);
  const state: ExternalCaptureState = {
    sessionId: opts.id,
    sourcePath: resolveSourcePath(opts.sourcePath, opts.root ?? "."),
    startedAtEpochMs: opts.startedAtEpochMs ?? Date.now(),
    driver: opts.driver,
  };
  writeExternalCaptureState(opts.id, opts.root ?? ".", state);
  return state;
}

export function stopExternalCaptureSession(opts: {
  id: string;
  root?: string;
  stoppedAtEpochMs?: number;
}): ExternalCaptureState {
  const root = opts.root ?? ".";
  const state = readExternalCaptureState(opts.id, root);
  if (!state) throw new Error(`No external capture state found for "${opts.id}". Run capture start-external first.`);
  const next = { ...state, stoppedAtEpochMs: opts.stoppedAtEpochMs ?? Date.now() };
  writeExternalCaptureState(opts.id, root, next);
  return next;
}

export function runCommand(command: string[], opts: { cwd?: string; timeoutMs?: number } = {}): CommandResult {
  if (command.length === 0) throw new Error("Missing command after --.");
  const result = spawnSync(command[0]!, command.slice(1), {
    cwd: opts.cwd,
    encoding: "utf-8",
    maxBuffer: 16 * 1024 * 1024,
    timeout: opts.timeoutMs ?? DEFAULT_COMMAND_TIMEOUT_MS,
  });
  const timedOut = (result.error as NodeJS.ErrnoException | undefined)?.code === "ETIMEDOUT";
  return {
    command,
    exitCode: result.status ?? (timedOut ? 124 : 1),
    stdout: result.stdout ?? "",
    stderr: result.stderr || (result.error ? result.error.message : ""),
    ...(timedOut ? { timedOut } : {}),
  };
}

export function runCapturedCommand(opts: {
  id: string;
  root?: string;
  command: string[];
  cwd?: string;
  eventType?: CaptureEventType | "auto" | "none";
  x?: number;
  y?: number;
  startedAtEpochMs?: number;
  timeoutMs?: number;
}): CapturedCommandResult {
  const root = opts.root ?? ".";
  const state = readExternalCaptureState(opts.id, root);
  const startedAtEpochMs = opts.startedAtEpochMs ?? state?.startedAtEpochMs;
  if (!startedAtEpochMs) {
    throw new Error(`No start timestamp for "${opts.id}". Run capture start-external first or pass startedAtEpochMs.`);
  }

  const explicit = explicitEvent(opts.eventType, opts.x, opts.y);
  const inferred = explicit ?? (opts.eventType === "none" ? null : inferEventFromCommand(opts.command, opts.cwd));
  const commandStartedMs = Math.max(0, Date.now() - startedAtEpochMs);
  const result = runCommand(opts.command, { cwd: opts.cwd, timeoutMs: opts.timeoutMs });
  const commandEndedMs = Math.max(commandStartedMs, Date.now() - startedAtEpochMs);
  let event: CaptureEvent | undefined;
  let eventSource: string | undefined;
  if (result.exitCode === 0 && inferred) {
    event = normalizeCaptureEvents([
      { ...inferred.event, t: commandEndedMs, startT: commandStartedMs, endT: commandEndedMs },
    ])[0]!;
    eventSource = inferred.source;
    recordCaptureEvent(opts.id, root, event);
  }
  return { ...result, event, eventSource };
}

function resolveSourcePath(sourcePath: string, root: string): string {
  return isAbsolute(sourcePath) ? sourcePath : resolve(root, sourcePath);
}

function explicitEvent(
  type: CaptureEventType | "auto" | "none" | undefined,
  x: number | undefined,
  y: number | undefined,
): { event: Omit<CaptureEvent, "t">; source: string } | null {
  if (!type || type === "auto" || type === "none") return null;
  if (x === undefined || y === undefined) {
    throw new Error(`Explicit event type "${type}" needs numeric x and y.`);
  }
  return { event: { type, x, y }, source: "explicit" };
}

function inferEventFromCommand(
  command: string[],
  cwd: string | undefined,
): { event: Omit<CaptureEvent, "t">; source: string } | null {
  if (command.length === 0) return null;
  const tool = basename(command[0]!);
  if (tool === "agent-browser") return inferAgentBrowserEvent(command, cwd);
  return inferCoordinateCliEvent(command);
}

function inferAgentBrowserEvent(
  command: string[],
  cwd: string | undefined,
): { event: Omit<CaptureEvent, "t">; source: string } | null {
  const verbIndex = command.findIndex((token, i) => i > 0 && AGENT_BROWSER_VERBS.has(token));
  if (verbIndex === -1) return null;
  const type = agentBrowserEventType(command, verbIndex);
  if (!type) return null;
  const selector = agentBrowserSelector(command, verbIndex);
  const box = selector ? getAgentBrowserBox(command, verbIndex, selector, cwd) : null;
  if (box) {
    return {
      event: {
        type,
        x: box.x + box.width / 2,
        y: box.y + box.height / 2,
      },
      source: "agent-browser-box",
    };
  }
  return { event: { type, x: 640, y: 360 }, source: "agent-browser-fallback" };
}

const AGENT_BROWSER_VERBS = new Set([
  "open",
  "click",
  "dblclick",
  "type",
  "fill",
  "press",
  "keyboard",
  "hover",
  "focus",
  "check",
  "uncheck",
  "select",
  "drag",
  "scroll",
  "back",
  "forward",
  "reload",
  "pushstate",
  "mouse",
]);

function agentBrowserEventType(command: string[], verbIndex: number): CaptureEventType | null {
  const verb = command[verbIndex]!;
  if (verb === "open" || verb === "back" || verb === "forward" || verb === "reload" || verb === "pushstate") {
    return "navigate";
  }
  if (verb === "type" || verb === "fill") return "type";
  if (verb === "keyboard")
    return command[verbIndex + 1] === "type" || command[verbIndex + 1] === "inserttext" ? "type" : null;
  if (verb === "scroll") return "scroll";
  if (verb === "mouse") return command[verbIndex + 1] === "wheel" ? "scroll" : "click";
  if (verb === "press") return "click";
  return "click";
}

function agentBrowserSelector(command: string[], verbIndex: number): string | null {
  const verb = command[verbIndex]!;
  if (verb === "keyboard" || verb === "open" || verb === "back" || verb === "forward" || verb === "reload") return null;
  if (verb === "mouse") return null;
  const candidate = command[verbIndex + 1];
  if (!candidate || candidate.startsWith("-")) return null;
  if (verb === "scroll" || verb === "press" || verb === "pushstate") return null;
  return candidate;
}

function getAgentBrowserBox(
  command: string[],
  verbIndex: number,
  selector: string,
  cwd: string | undefined,
): { x: number; y: number; width: number; height: number } | null {
  const exe = command[0]!;
  const globalArgs = command.slice(1, verbIndex).filter((arg) => arg !== "--json");
  try {
    const raw = execFileSync(exe, [...globalArgs, "get", "box", selector, "--json"], {
      cwd,
      encoding: "utf-8",
      stdio: ["ignore", "pipe", "ignore"],
      timeout: 5000,
    });
    const parsed = JSON.parse(raw) as Record<string, unknown>;
    const data = parsed.data && typeof parsed.data === "object" ? (parsed.data as Record<string, unknown>) : parsed;
    if (typeof data.x !== "number" || typeof data.y !== "number") return null;
    return {
      x: data.x,
      y: data.y,
      width: typeof data.width === "number" ? data.width : 0,
      height: typeof data.height === "number" ? data.height : 0,
    };
  } catch {
    return null;
  }
}

function inferCoordinateCliEvent(command: string[]): { event: Omit<CaptureEvent, "t">; source: string } | null {
  const verbIndex = command.findIndex((token) =>
    ["tap", "click", "type", "type_text", "swipe", "scroll"].includes(token),
  );
  if (verbIndex === -1) return null;
  const verb = command[verbIndex]!;
  const nums = command
    .slice(verbIndex + 1)
    .map(Number)
    .filter(Number.isFinite);
  if (verb === "tap" || verb === "click") {
    return { event: { type: "click", x: nums[0] ?? 640, y: nums[1] ?? 360 }, source: "coordinate-cli" };
  }
  if (verb === "type" || verb === "type_text") {
    return { event: { type: "type", x: nums[0] ?? 640, y: nums[1] ?? 360 }, source: "coordinate-cli" };
  }
  return { event: { type: "scroll", x: nums[0] ?? 640, y: nums[1] ?? 360 }, source: "coordinate-cli" };
}
