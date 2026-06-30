import { test, expect } from "bun:test";
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { assertValidSessionId, importCaptureSession, sessionPath, resolveSession } from "../src/sessions.ts";

test("valid session ids are accepted", () => {
  for (const id of ["demo", "Demo_1", "a-b-c", "x".repeat(64)]) {
    expect(() => assertValidSessionId(id)).not.toThrow();
  }
});

test("path-traversal / absolute / odd ids are rejected (untrusted spec input)", () => {
  for (const bad of ["../evil", "../../tmp/x", "/etc/passwd", "a/b", "foo.mp4", "", "x".repeat(65), "a b"]) {
    expect(() => assertValidSessionId(bad)).toThrow();
  }
});

test("resolveSession refuses to escape the captures sandbox", () => {
  // invalid ids throw before any filesystem lookup → no arbitrary-file read
  expect(() => resolveSession("../../../../etc/hosts")).toThrow();
  expect(() => resolveSession("/etc/hosts")).toThrow();
  // a valid-but-missing id throws a "not found" (still inside the sandbox)
  expect(() => resolveSession("definitely-not-here")).toThrow(/not found/);
});

test("sessionPath confines to the captures dir", () => {
  const p = sessionPath("clip", "/tmp/proj");
  expect(p).toBe("/tmp/proj/.agent-video/captures/clip.mp4");
  expect(() => sessionPath("../clip")).toThrow();
});

test("importCaptureSession preserves an existing session when transcode fails", () => {
  const dir = mkdtempSync(join(tmpdir(), "av-import-atomic-"));
  try {
    const out = sessionPath("demo", dir);
    mkdirSync(dirname(out), { recursive: true });
    writeFileSync(out, "existing-good-session");
    const badSource = join(dir, "not-video.txt");
    writeFileSync(badSource, "not a video");

    expect(() => importCaptureSession({ id: "demo", root: dir, sourcePath: badSource })).toThrow();
    expect(readFileSync(out, "utf-8")).toBe("existing-good-session");
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});
