import { test, expect } from "bun:test";
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { tmpdir } from "node:os";
import { loadSessionEvents, recordCaptureEvent, sessionPath } from "../src/index.ts";

function sidecarPath(id: string, root: string): string {
  return sessionPath(id, root).replace(/\.mp4$/, ".events.json");
}

test("appending an event does not overwrite a malformed sidecar", () => {
  const dir = mkdtempSync(join(tmpdir(), "av-events-"));
  try {
    const path = sidecarPath("broken", dir);
    mkdirSync(dirname(path), { recursive: true });
    writeFileSync(path, "{ not json");

    expect(() => loadSessionEvents("broken", dir)).toThrow();
    expect(() => recordCaptureEvent("broken", dir, { t: 0, type: "click", x: 1, y: 2 })).toThrow();
    expect(readFileSync(path, "utf-8")).toBe("{ not json");
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});
