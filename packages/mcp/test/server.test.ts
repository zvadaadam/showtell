import { test, expect } from "bun:test";
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

const TOOLS = ["agent_video_get_schema", "agent_video_validate_spec", "agent_video_render", "agent_video_preview", "agent_video_get_video"];

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
  await client.close();
});

test("agent_video_validate_spec: good → ok, bad → errors with hint", async () => {
  const client = await connect();
  const good = parse(await client.callTool({ name: "agent_video_validate_spec", arguments: { spec: titleSpec } })) as { ok: boolean; sceneCount: number };
  expect(good.ok).toBe(true);
  expect(good.sceneCount).toBe(1);

  const bad = parse(await client.callTool({ name: "agent_video_validate_spec", arguments: { spec: { meta: { title: "x" }, scenes: [{ kind: "nope", content: {}, narration: "x" }] } } })) as { ok: boolean; errors: { hint?: string }[] };
  expect(bad.ok).toBe(false);
  expect(bad.errors.length).toBeGreaterThan(0);
  await client.close();
});

test("agent_video_render produces an mp4 and returns structuredContent matching outputSchema", async () => {
  const client = await connect();
  const res = (await client.callTool({ name: "agent_video_render", arguments: { spec: titleSpec, aspectRatios: ["16:9"] } })) as {
    structuredContent?: { ok: boolean; videoId: string; outputs: { aspectRatio: string }[] };
  };
  // outputSchema → the SDK validates and returns structuredContent
  expect(res.structuredContent).toBeDefined();
  expect(res.structuredContent!.ok).toBe(true);
  expect(res.structuredContent!.videoId).toMatch(/^[0-9a-f]{32}$/);
  expect(res.structuredContent!.outputs[0]!.aspectRatio).toBe("16:9");
  await client.close();
}, 30_000);
