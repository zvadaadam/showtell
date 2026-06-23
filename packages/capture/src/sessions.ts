/** Capture session store: recordings live at <root>/.agent-video/captures/<id>.mp4. */
import { existsSync, mkdirSync } from "node:fs";
import { execFileSync } from "node:child_process";
import { join, isAbsolute } from "node:path";

export function capturesDir(root = "."): string {
  return join(root, ".agent-video", "captures");
}

export function ensureCapturesDir(root = "."): string {
  const d = capturesDir(root);
  mkdirSync(d, { recursive: true });
  return d;
}

export function sessionPath(id: string, root = "."): string {
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
    ["-y", "-loglevel", "error", "-f", "lavfi", "-i", `testsrc=size=1440x900:rate=30:duration=${seconds}`, "-pix_fmt", "yuv420p", p],
    { stdio: ["ignore", "pipe", "pipe"] },
  );
  return p;
}

/** Resolve a screencap scene's sessionRef to a real recording path. */
export function resolveSession(sessionRef: string, root = "."): string {
  // Allow a direct path (absolute or .mp4) or a session id.
  if ((isAbsolute(sessionRef) || sessionRef.endsWith(".mp4")) && existsSync(sessionRef)) {
    return sessionRef;
  }
  const p = sessionPath(sessionRef, root);
  if (existsSync(p)) return p;
  throw new Error(
    `Capture session "${sessionRef}" not found (looked at ${p}). Record one with \`agent-video capture\` first.`,
  );
}
