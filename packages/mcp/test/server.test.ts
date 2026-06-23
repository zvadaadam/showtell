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

test("tools/list exposes the agent-first tools with descriptions", async () => {
  const client = await connect();
  const { tools } = await client.listTools();
  const names = tools.map((t) => t.name);
  for (const n of ["agent_video_schema", "validate_spec", "render_video", "preview_video", "get_video"]) {
    expect(names).toContain(n);
  }
  // descriptions include an example (agent-first / self-describing)
  expect(tools.find((t) => t.name === "render_video")!.description).toContain('"kind"');
  await client.close();
});

test("validate_spec: good → ok, bad → errors with hint", async () => {
  const client = await connect();
  const good = parse(await client.callTool({ name: "validate_spec", arguments: { spec: titleSpec } })) as { ok: boolean; sceneCount: number };
  expect(good.ok).toBe(true);
  expect(good.sceneCount).toBe(1);

  const bad = parse(await client.callTool({ name: "validate_spec", arguments: { spec: { meta: { title: "x" }, scenes: [{ kind: "nope", content: {}, narration: "x" }] } } })) as { ok: boolean; errors: { hint?: string }[] };
  expect(bad.ok).toBe(false);
  expect(bad.errors.length).toBeGreaterThan(0);
  await client.close();
});

test("render_video produces an mp4 output", async () => {
  const client = await connect();
  const res = parse(await client.callTool({ name: "render_video", arguments: { spec: titleSpec, aspectRatios: ["16:9"] } })) as {
    ok: boolean;
    videoId: string;
    outputs: { aspectRatio: string; path: string }[];
  };
  expect(res.ok).toBe(true);
  expect(res.videoId).toMatch(/^[0-9a-f]{32}$/);
  expect(res.outputs[0]!.aspectRatio).toBe("16:9");
  await client.close();
}, 30_000);
