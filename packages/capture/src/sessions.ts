/** Capture session store: recordings live at <root>/.agent-video/captures/<id>.mp4. */
import { existsSync, mkdirSync, renameSync, rmSync, statSync } from "node:fs";
import { execFileSync } from "node:child_process";
import { join, resolve } from "node:path";
import { DETERMINISTIC_CONTAINER_ARGS, DETERMINISTIC_VIDEO_ARGS, FASTSTART_ARGS } from "./encode.ts";

/** Session ids are sandbox-safe by construction — no path separators, no traversal. */
const VALID_ID = /^[A-Za-z0-9_-]{1,64}$/;

export function assertValidSessionId(id: string): void {
  if (!VALID_ID.test(id)) {
    throw new Error(
      `Invalid capture session id "${id}". Allowed: letters, digits, "_" and "-" (max 64 chars). ` +
        `Session ids are filenames under .agent-video/captures — paths are not permitted.`,
    );
  }
}

function capturesDir(root = "."): string {
  return join(root, ".agent-video", "captures");
}

export function ensureCapturesDir(root = "."): string {
  const d = capturesDir(root);
  mkdirSync(d, { recursive: true });
  return d;
}

export function sessionPath(id: string, root = "."): string {
  assertValidSessionId(id);
  return join(capturesDir(root), `${id}.mp4`);
}

/** Provision a synthetic capture session (ffmpeg testsrc) if one doesn't exist.
 *  Used by `agent-video eval` so the self-test renders screencap scenes without
 *  Screen Recording permission. */
export function ensureSyntheticSession(id: string, root = ".", seconds = 4): string {
  const p = sessionPath(id, root);
  if (existsSync(p)) return p;
  ensureCapturesDir(root);
  execFileSync(
    "ffmpeg",
    [
      "-y",
      "-loglevel",
      "error",
      "-f",
      "lavfi",
      "-i",
      `testsrc=size=1440x900:rate=30:duration=${seconds}`,
      "-pix_fmt",
      "yuv420p",
      p,
    ],
    { stdio: ["ignore", "pipe", "pipe"] },
  );
  return p;
}

export function importCaptureSession(opts: { id: string; sourcePath: string; root?: string }): {
  sessionId: string;
  path: string;
  bytes: number;
} {
  assertValidSessionId(opts.id);
  const sourcePath = resolve(opts.root ?? ".", opts.sourcePath);
  if (!existsSync(sourcePath)) {
    throw new Error(`Capture source not found: ${sourcePath}`);
  }
  ensureCapturesDir(opts.root);
  const out = sessionPath(opts.id, opts.root);
  const tmp = `${out}.tmp-${process.pid}.mp4`;
  try {
    execFileSync(
      "ffmpeg",
      [
        "-y",
        "-loglevel",
        "error",
        "-i",
        sourcePath,
        "-map",
        "0:v:0",
        "-an",
        ...DETERMINISTIC_VIDEO_ARGS,
        ...FASTSTART_ARGS,
        ...DETERMINISTIC_CONTAINER_ARGS,
        tmp,
      ],
      { stdio: ["ignore", "pipe", "pipe"] },
    );
    renameSync(tmp, out);
  } catch (e) {
    rmSync(tmp, { force: true });
    throw e;
  }
  return { sessionId: opts.id, path: out, bytes: statSync(out).size };
}

/**
 * Resolve a screencap scene's sessionRef (from an untrusted, agent-authored spec)
 * to a real recording path. Resolution is confined to the captures sandbox by
 * construction: the ref must be a valid session id, and the resolved file must
 * live inside <root>/.agent-video/captures. No absolute paths, no traversal,
 * no "any .mp4 on disk" — those would be arbitrary-file-read primitives.
 */
export function resolveSession(sessionRef: string, root = "."): string {
  assertValidSessionId(sessionRef);
  const p = sessionPath(sessionRef, root);
  const dir = resolve(capturesDir(root));
  // Defense in depth: the regex already forbids separators, but assert containment.
  if (!resolve(p).startsWith(dir + "/") && resolve(p) !== dir) {
    throw new Error(`Refusing to resolve session outside the captures sandbox: ${sessionRef}`);
  }
  if (existsSync(p)) return p;
  throw new Error(
    `Capture session "${sessionRef}" not found (looked at ${p}). Record one with \`agent-video capture --id ${sessionRef}\` first.`,
  );
}
