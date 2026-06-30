import { test, expect } from "bun:test";
import { chmodSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  loadSessionEvents,
  runCapturedCommand,
  runCommand,
  startExternalCaptureSession,
  startExternalCaptureWorkflow,
} from "../src/index.ts";

test("captured command infers agent-browser element boxes without reimplementing the CLI", () => {
  const dir = mkdtempSync(join(tmpdir(), "av-external-"));
  try {
    const fake = join(dir, "agent-browser");
    writeFileSync(
      fake,
      `#!/usr/bin/env bun
const args = process.argv.slice(2);
if (args[0] === "get" && args[1] === "box") {
  process.stdout.write(JSON.stringify({ success: true, data: { x: 10, y: 20, width: 40, height: 20 }, error: null }));
} else {
  process.stdout.write("clicked");
}
`,
    );
    chmodSync(fake, 0o755);

    startExternalCaptureSession({
      id: "browserbox",
      root: dir,
      sourcePath: "raw.mp4",
      startedAtEpochMs: Date.now() - 1000,
    });
    const result = runCapturedCommand({ id: "browserbox", root: dir, command: [fake, "click", "@e3"], cwd: dir });
    expect(result.exitCode).toBe(0);
    expect(result.eventSource).toBe("agent-browser-box");
    expect(result.event).toMatchObject({ type: "click", x: 30, y: 30 });
    expect(result.event!.startT).toBeLessThanOrEqual(result.event!.t);
    expect(result.event!.endT).toBe(result.event!.t);
    expect(loadSessionEvents("browserbox", dir)).toHaveLength(1);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("external commands time out with a structured exit code", () => {
  const result = runCommand(["bun", "-e", "setTimeout(() => {}, 1000)"], { timeoutMs: 20 });
  expect(result.exitCode).toBe(124);
  expect(result.timedOut).toBe(true);
});

test("external capture start time is recorded after the start command exits", () => {
  const dir = mkdtempSync(join(tmpdir(), "av-start-time-"));
  try {
    const stamp = join(dir, "started.txt");
    const result = startExternalCaptureWorkflow({
      id: "starttime",
      root: dir,
      sourcePath: "raw.mp4",
      command: ["bun", "-e", "require('fs').writeFileSync(process.argv[1], String(Date.now()))", stamp],
    });
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.state.startedAtEpochMs).toBeGreaterThanOrEqual(Number(readFileSync(stamp, "utf-8")));
    }
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});
