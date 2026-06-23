/**
 * agent-video MCP server. Agent-first: rich tool descriptions with examples,
 * the full spec schema via a tool, structured results, actionable errors.
 * Reuses the same @agent-video/render packages as the CLI (logic not forked).
 */
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { createHash } from "node:crypto";
import { z } from "zod";
import { validateSpec, videoSpecJsonSchema, type VideoSpec } from "@agent-video/core";
import { renderVideo, startPreviewServer, type PreviewHandle } from "@agent-video/render";

const SPEC_EXAMPLE = `{
  "meta": { "title": "PR: idempotency keys", "aspectRatios": ["16:9","9:16"], "repo": { "path": "." } },
  "scenes": [
    { "kind": "title", "content": { "heading": "Idempotency keys" }, "narration": "This PR makes the webhook safe to retry.", "duration": "auto" },
    { "kind": "diff", "content": { "file": "src/webhook.ts", "ref": "main..HEAD" }, "narration": "We check the key before processing.", "duration": "auto" }
  ]
}`;

const ASPECT = z.enum(["16:9", "9:16", "1:1"]);

function specId(spec: unknown): string {
  return createHash("sha256").update(JSON.stringify(spec)).digest("hex").slice(0, 32);
}

function textResult(data: unknown, isError = false): { content: { type: "text"; text: string }[]; structuredContent?: Record<string, unknown>; isError?: true } {
  const out: { content: { type: "text"; text: string }[]; structuredContent?: Record<string, unknown>; isError?: true } = {
    content: [{ type: "text", text: JSON.stringify(data, null, 2) }],
  };
  if (data && typeof data === "object") out.structuredContent = data as Record<string, unknown>;
  if (isError) out.isError = true;
  return out;
}

export function createServer(): { server: McpServer; previews: Map<string, PreviewHandle> } {
  const server = new McpServer({ name: "agent-video", version: "0.0.0" });
  const previews = new Map<string, PreviewHandle>();

  server.registerTool(
    "agent_video_schema",
    {
      title: "Get the spec schema",
      description:
        "Return the published JSON Schema for an agent-video spec.json. Call this first if unsure of the spec shape.\n\nScene kinds: title, code, diff, talking-points, chart, screencap. code/diff carry repo references (file, lineStart/End, git ref) — never pasted source.",
      inputSchema: {},
    },
    async () => textResult(videoSpecJsonSchema()),
  );

  server.registerTool(
    "validate_spec",
    {
      title: "Validate a spec",
      description: `Validate an agent-video spec against the contract. Returns { ok, sceneCount, kinds } or { ok:false, errors:[{path,message,hint}] }. Each error includes a hint.\n\nExample spec:\n${SPEC_EXAMPLE}`,
      inputSchema: { spec: z.record(z.unknown()).describe("The spec.json object to validate.") },
    },
    async ({ spec }) => {
      const r = validateSpec(spec);
      if (!r.ok) return textResult({ ok: false, errors: r.errors }, false);
      return textResult({ ok: true, sceneCount: r.spec.scenes.length, kinds: r.spec.scenes.map((s) => s.kind), warnings: r.warnings });
    },
  );

  server.registerTool(
    "render_video",
    {
      title: "Render a spec to mp4",
      description: `Render an agent-video spec to mp4 in each aspect ratio. Returns { videoId, outputs:[{aspectRatio,path,durationMs}], scenes }. Validates first; on invalid spec returns errors with hints.\n\nThe agent authors ONLY the spec (scenes + narration); never ffmpeg or pasted code.\n\nExample spec:\n${SPEC_EXAMPLE}`,
      inputSchema: {
        spec: z.record(z.unknown()).describe("The spec.json object."),
        repoPath: z.string().optional().describe("Repo root for resolving file:line / git refs. Default: spec.meta.repo.path."),
        aspectRatios: z.array(ASPECT).optional().describe("Override meta.aspectRatios."),
        outDir: z.string().optional().describe("Output directory. Default: .agent-video/out."),
      },
    },
    async ({ spec, repoPath, aspectRatios, outDir }) => {
      const r = validateSpec(spec);
      if (!r.ok) return textResult({ ok: false, error: "Spec failed validation.", errors: r.errors }, true);
      try {
        const result = await renderVideo(r.spec as VideoSpec, {
          repoPath: repoPath ?? r.spec.meta.repo.path,
          outDir: outDir ?? ".agent-video/out",
          baseName: "video",
          aspectRatios,
        });
        return textResult({ ok: true, videoId: specId(spec), outputs: result.outputs, scenes: result.scenes, skipped: result.skipped });
      } catch (e) {
        return textResult({ ok: false, error: `Render failed: ${(e as Error).message}`, hint: "Check file/line refs, repo path, and that ffmpeg is installed." }, true);
      }
    },
  );

  server.registerTool(
    "preview_video",
    {
      title: "Render and serve a watch page",
      description: `Render the spec, then serve a localhost watch page. Returns { videoId, status:"success", watchUrl } immediately (the server keeps running). Use get_video to re-check.\n\nExample spec:\n${SPEC_EXAMPLE}`,
      inputSchema: {
        spec: z.record(z.unknown()).describe("The spec.json object."),
        repoPath: z.string().optional(),
        port: z.number().int().optional().describe("Fixed port (default: random free port)."),
      },
    },
    async ({ spec, repoPath, port }) => {
      const r = validateSpec(spec);
      if (!r.ok) return textResult({ ok: false, error: "Spec failed validation.", errors: r.errors }, true);
      try {
        const videoId = specId(spec);
        const result = await renderVideo(r.spec as VideoSpec, { repoPath: repoPath ?? r.spec.meta.repo.path, outDir: ".agent-video/out", baseName: "video" });
        const handle = startPreviewServer({ outputs: result.outputs, title: r.spec.meta.title, videoId, port });
        previews.set(videoId, handle);
        return textResult({ ok: true, videoId, status: "success", watchUrl: handle.watchUrl, outputs: result.outputs });
      } catch (e) {
        return textResult({ ok: false, error: `Preview failed: ${(e as Error).message}` }, true);
      }
    },
  );

  server.registerTool(
    "get_video",
    {
      title: "Get video status",
      description: "Get the status of a previewed video by id. Returns { videoId, status, watchUrl } (status: success | not_found).",
      inputSchema: { videoId: z.string().describe("The 32-char video id from render_video/preview_video.") },
    },
    async ({ videoId }) => {
      const handle = previews.get(videoId);
      if (!handle) return textResult({ videoId, status: "not_found" });
      return textResult({ videoId, status: "success", watchUrl: handle.watchUrl });
    },
  );

  return { server, previews };
}
