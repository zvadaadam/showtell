import { test, expect } from "bun:test";
import { assertValidSessionId, sessionPath, resolveSession } from "../src/sessions.ts";

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
