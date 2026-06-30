import { test, expect } from "bun:test";
import { mkdtempSync } from "node:fs";
import { execFileSync } from "node:child_process";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import { createServer } from "../src/server.ts";

async function connect() {
  const { server } = createServer();
  const [clientT, serverT] = InMemoryTransport.createLinkedPair();
  const client = new Client({ name: "test", version: "0" });
  await Promise.all([server.connect(serverT), client.connect(clientT)]);
  return client;
}

function parse(res: { content: { type: string; text?: string }[] }): unknown {
  return JSON.parse(res.content[0]!.text!);
}

const titleSpec = {
  meta: { title: "t", aspectRatios: ["16:9"], tts: { provider: "say" }, repo: { path: "." } },
  scenes: [{ kind: "title", content: { heading: "Hi" }, narration: "hi.", duration: "auto" }],
};

const TOOLS = [
  "agent_video_get_schema",
  "agent_video_validate_spec",
  "agent_video_render",
  "agent_video_preview",
  "agent_video_import_capture",
  "agent_video_analyze_capture",
  "agent_video_capture_start_external",
  "agent_video_capture_exec_cli",
  "agent_video_capture_stop_external",
  "agent_video_record_capture_event",
  "agent_video_get_video",
];

test("tools/list: service-prefixed names, example-rich descriptions, and annotations on every tool", async () => {
  const client = await connect();
  const { tools } = await client.listTools();
  const names = tools.map((t) => t.name);
  for (const n of TOOLS) expect(names).toContain(n);
  // every tool name carries the service prefix (avoids collisions with other MCP servers)
  for (const n of names) expect(n.startsWith("agent_video_")).toBe(true);
  // descriptions include an example (agent-first / self-describing)
  expect(tools.find((t) => t.name === "agent_video_render")!.description).toContain('"kind"');
  // annotations present on every tool (mcp-builder hard requirement)
  for (const t of tools) {
    expect(t.annotations).toBeDefined();
    expect(typeof t.annotations!.readOnlyHint).toBe("boolean");
  }
  // read-only tools are marked as such; render/preview are not
  expect(tools.find((t) => t.name === "agent_video_get_schema")!.annotations!.readOnlyHint).toBe(true);
  expect(tools.find((t) => t.name === "agent_video_render")!.annotations!.readOnlyHint).toBe(false);
  expect(tools.find((t) => t.name === "agent_video_capture_exec_cli")!.annotations!.destructiveHint).toBe(true);
  expect(tools.find((t) => t.name === "agent_video_capture_exec_cli")!.annotations!.openWorldHint).toBe(true);
  await client.close();
});

test("agent_video_validate_spec: good → ok, bad → errors with hint", async () => {
  const client = await connect();
  const good = parse(await client.callTool({ name: "agent_video_validate_spec", arguments: { spec: titleSpec } })) as {
    ok: boolean;
    sceneCount: number;
  };
  expect(good.ok).toBe(true);
  expect(good.sceneCount).toBe(1);

  const bad = parse(
    await client.callTool({
      name: "agent_video_validate_spec",
      arguments: { spec: { meta: { title: "x" }, scenes: [{ kind: "nope", content: {}, narration: "x" }] } },
    }),
  ) as { ok: boolean; errors: { hint?: string }[] };
  expect(bad.ok).toBe(false);
  expect(bad.errors.length).toBeGreaterThan(0);
  await client.close();
});

test("agent_video_render produces an mp4 and returns structuredContent matching outputSchema", async () => {
  const client = await connect();
  const res = (await client.callTool({
    name: "agent_video_render",
    arguments: { spec: titleSpec, aspectRatios: ["16:9"] },
  })) as {
    structuredContent?: { ok: boolean; videoId: string; outputs: { aspectRatio: string }[] };
  };
  // outputSchema → the SDK validates and returns structuredContent
  expect(res.structuredContent).toBeDefined();
  expect(res.structuredContent!.ok).toBe(true);
  expect(res.structuredContent!.videoId).toMatch(/^[0-9a-f]{32}$/);
  expect(res.structuredContent!.outputs[0]!.aspectRatio).toBe("16:9");
  await client.close();
}, 30_000);

test("agent_video_record_capture_event appends structured event data", async () => {
  const client = await connect();
  const repoPath = mkdtempSync(join(tmpdir(), "av-mcp-cap-"));
  const res = (await client.callTool({
    name: "agent_video_record_capture_event",
    arguments: { sessionId: "browserdemo", repoPath, type: "click", x: 12, y: 34, tMs: 1000 },
  })) as {
    structuredContent?: { ok: boolean; eventCount: number; event: { type: string } };
  };
  expect(res.structuredContent).toBeDefined();
  expect(res.structuredContent!.ok).toBe(true);
  expect(res.structuredContent!.eventCount).toBe(1);
  expect(res.structuredContent!.event.type).toBe("click");
  await client.close();
});

test("external capture MCP workflow records explicit CLI events", async () => {
  const client = await connect();
  const repoPath = mkdtempSync(join(tmpdir(), "av-mcp-external-"));
  const source = join(repoPath, "raw.mp4");
  execFileSync("ffmpeg", [
    "-y",
    "-loglevel",
    "error",
    "-f",
    "lavfi",
    "-i",
    "testsrc=size=64x64:rate=10:duration=0.4",
    "-pix_fmt",
    "yuv420p",
    source,
  ]);

  const start = parse(
    await client.callTool({
      name: "agent_video_capture_start_external",
      arguments: { sessionId: "cliwrap", repoPath, sourcePath: "raw.mp4" },
    }),
  ) as { ok: boolean };
  expect(start.ok).toBe(true);

  const exec = parse(
    await client.callTool({
      name: "agent_video_capture_exec_cli",
      arguments: {
        sessionId: "cliwrap",
        repoPath,
        command: ["bun", "-e", "process.stdout.write('ok')"],
        eventType: "click",
        x: 10,
        y: 20,
      },
    }),
  ) as { ok: boolean; event: { type: string }; eventCount: number };
  expect(exec.ok).toBe(true);
  expect(exec.event.type).toBe("click");
  expect(exec.eventCount).toBe(1);

  const stop = parse(
    await client.callTool({
      name: "agent_video_capture_stop_external",
      arguments: { sessionId: "cliwrap", repoPath },
    }),
  ) as { ok: boolean; imported: { path: string } };
  expect(stop.ok).toBe(true);
  expect(stop.imported.path).toContain("cliwrap.mp4");
  await client.close();
}, 30_000);
