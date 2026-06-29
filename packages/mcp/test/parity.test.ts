import { test, expect } from "bun:test";
import { spawnSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import { createServer } from "../src/server.ts";
import { specContentId, validateSpec } from "@agent-video/core";

// The CLI and the MCP server are two surfaces over the SAME library. This locks
// the contract that they agree on the core output shape (no surface drift).

const ROOT = join(import.meta.dir, "..", "..", "..");
const CLI = join(ROOT, "packages", "cli", "src", "index.ts");
const SPEC_PATH = "examples/hello.spec.json";

async function mcpClient() {
  const { server } = createServer();
  const [ct, st] = InMemoryTransport.createLinkedPair();
  const client = new Client({ name: "t", version: "0" });
  await Promise.all([server.connect(st), client.connect(ct)]);
  return client;
}

test("validate agrees across the CLI and the MCP server", async () => {
  // CLI surface (reads a file path)
  const r = spawnSync("bun", [CLI, "validate", SPEC_PATH], { cwd: ROOT, encoding: "utf-8" });
  expect(r.status).toBe(0);
  const cli = JSON.parse(r.stdout) as { ok: boolean; sceneCount: number; kinds: string[] };

  // MCP surface (takes the spec object)
  const spec = JSON.parse(readFileSync(join(ROOT, SPEC_PATH), "utf-8"));
  const client = await mcpClient();
  const res = (await client.callTool({ name: "agent_video_validate_spec", arguments: { spec } })) as {
    structuredContent: { ok: boolean; sceneCount: number; kinds: string[] };
  };
  const mcp = res.structuredContent;
  await client.close();

  // both succeed and report the same scene count + kinds in the same order
  expect(cli.ok).toBe(true);
  expect(mcp.ok).toBe(true);
  expect(mcp.sceneCount).toBe(cli.sceneCount);
  expect(mcp.kinds).toEqual(cli.kinds);
}, 20_000);

test("render videoId is based on the validated spec, not raw input shape", async () => {
  const raw = {
    meta: { title: "id", aspectRatios: ["16:9"], tts: { provider: "say" }, repo: { path: "." } },
    scenes: [{ kind: "title", content: { heading: "Hi" }, narration: "hi." }],
  };
  const parsed = validateSpec(raw);
  if (!parsed.ok) throw new Error("test spec should validate");

  const client = await mcpClient();
  const res = (await client.callTool({
    name: "agent_video_render",
    arguments: { spec: raw, aspectRatios: ["16:9"] },
  })) as { structuredContent: { videoId: string } };
  await client.close();

  expect(res.structuredContent.videoId).toBe(specContentId(parsed.spec));
  expect(res.structuredContent.videoId).not.toBe(specContentId(raw));
}, 30_000);
