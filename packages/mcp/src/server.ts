/**
 * agent-video MCP server. Agent-first (per the mcp-builder best practices):
 * service-prefixed snake_case tool names, rich descriptions with examples,
 * Zod input + output schemas, structured results, actionable errors with hints,
 * and tool annotations. Reuses the same @agent-video/render packages as the CLI
 * (rendering logic is never forked).
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

/** Shared error-detail shape for output schemas (mirrors validateSpec's errors). */
const ERROR_DETAIL = z.object({ path: z.string(), message: z.string(), hint: z.string().optional() });
const OUTPUT_Ref = z.object({ aspectRatio: z.string(), path: z.string(), durationMs: z.number().optional() });

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
  // Node/TypeScript naming convention: `{service}-mcp-server`.
  const server = new McpServer({ name: "agent-video-mcp-server", version: "0.0.0" });
  const previews = new Map<string, PreviewHandle>();

  server.registerTool(
    "agent_video_get_schema",
    {
      title: "Get the agent-video spec schema",
      description:
        "Return the published JSON Schema for an agent-video spec.json. Call this first if unsure of the spec shape.\n\nScene kinds: title, code, diff, talking-points, chart, screencap. code/diff carry repo references (file, lineStart/End, git ref) — never pasted source.\n\nReturns: the JSON Schema object (draft-07).",
      inputSchema: {},
      annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: false },
    },
    async () => textResult(videoSpecJsonSchema()),
  );

  server.registerTool(
    "agent_video_validate_spec",
    {
      title: "Validate an agent-video spec",
      description: `Validate an agent-video spec against the contract. Does NOT render or touch the repo — schema/shape check only.

Returns (JSON):
  - on success: { "ok": true, "sceneCount": number, "kinds": string[], "warnings": [{path,message,hint}] }
  - on failure: { "ok": false, "errors": [{path,message,hint}] }  — each error carries a fix hint.

Example spec:
${SPEC_EXAMPLE}`,
      inputSchema: { spec: z.record(z.unknown()).describe("The spec.json object to validate.") },
      outputSchema: {
        ok: z.boolean(),
        sceneCount: z.number().optional(),
        kinds: z.array(z.string()).optional(),
        warnings: z.array(ERROR_DETAIL).optional(),
        errors: z.array(ERROR_DETAIL).optional(),
      },
      annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: false },
    },
    async ({ spec }) => {
      const r = validateSpec(spec);
      if (!r.ok) return textResult({ ok: false, errors: r.errors });
      return textResult({ ok: true, sceneCount: r.spec.scenes.length, kinds: r.spec.scenes.map((s) => s.kind), warnings: r.warnings });
    },
  );

  server.registerTool(
    "agent_video_render",
    {
      title: "Render an agent-video spec to mp4",
      description: `Render an agent-video spec to an mp4 in each aspect ratio. Validates first; on an invalid spec returns { ok:false, errors } with hints (no files written).

The agent authors ONLY the spec (scenes + narration); it never writes ffmpeg or pasted code. Reads live repo bytes for code/diff scenes (rendered code == source).

Returns (JSON): { "ok": true, "videoId": string(32-hex), "outputs": [{ "aspectRatio": string, "path": string, "durationMs": number }], "scenes": [...], "skipped": [...] }

Example spec:
${SPEC_EXAMPLE}`,
      inputSchema: {
        spec: z.record(z.unknown()).describe("The spec.json object."),
        repoPath: z.string().optional().describe("Repo root for resolving file:line / git refs. Default: spec.meta.repo.path."),
        aspectRatios: z.array(ASPECT).optional().describe("Override meta.aspectRatios."),
        outDir: z.string().optional().describe("Output directory. Default: .agent-video/out."),
      },
      outputSchema: {
        ok: z.boolean(),
        videoId: z.string().optional(),
        outputs: z.array(OUTPUT_Ref).optional(),
        scenes: z.array(z.record(z.unknown())).optional(),
        skipped: z.array(z.record(z.unknown())).optional(),
        warnings: z.array(z.object({ scene: z.number(), message: z.string() })).optional(),
        error: z.string().optional(),
        errors: z.array(ERROR_DETAIL).optional(),
        hint: z.string().optional(),
      },
      // Writes mp4 files; not destructive (only creates outputs), not idempotent (timestamps/paths), local-only.
      annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: false, openWorldHint: false },
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
        return textResult({ ok: true, videoId: specId(spec), outputs: result.outputs, scenes: result.scenes, skipped: result.skipped, warnings: result.warnings });
      } catch (e) {
        return textResult({ ok: false, error: `Render failed: ${(e as Error).message}`, hint: "Check file/line refs, repo path, and that ffmpeg is installed." }, true);
      }
    },
  );

  server.registerTool(
    "agent_video_preview",
    {
      title: "Render and serve a watch page",
      description: `Render the spec, then serve a localhost watch page. Returns { videoId, status:"success", watchUrl } immediately (the server keeps running in the background). Use agent_video_get_video to re-check.

Returns (JSON): { "ok": true, "videoId": string, "status": "success", "watchUrl": string, "outputs": [...] }

Example spec:
${SPEC_EXAMPLE}`,
      inputSchema: {
        spec: z.record(z.unknown()).describe("The spec.json object."),
        repoPath: z.string().optional().describe("Repo root for resolving refs. Default: spec.meta.repo.path."),
        port: z.number().int().optional().describe("Fixed port (default: random free port)."),
      },
      outputSchema: {
        ok: z.boolean(),
        videoId: z.string().optional(),
        status: z.string().optional(),
        watchUrl: z.string().optional(),
        outputs: z.array(OUTPUT_Ref).optional(),
        warnings: z.array(z.object({ scene: z.number(), message: z.string() })).optional(),
        error: z.string().optional(),
        errors: z.array(ERROR_DETAIL).optional(),
      },
      // Starts a long-lived local server + writes files; local-only.
      annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: false, openWorldHint: false },
    },
    async ({ spec, repoPath, port }) => {
      const r = validateSpec(spec);
      if (!r.ok) return textResult({ ok: false, error: "Spec failed validation.", errors: r.errors }, true);
      try {
        const videoId = specId(spec);
        const result = await renderVideo(r.spec as VideoSpec, { repoPath: repoPath ?? r.spec.meta.repo.path, outDir: ".agent-video/out", baseName: "video" });
        const handle = startPreviewServer({ outputs: result.outputs, title: r.spec.meta.title, videoId, port });
        previews.set(videoId, handle);
        return textResult({ ok: true, videoId, status: "success", watchUrl: handle.watchUrl, outputs: result.outputs, warnings: result.warnings });
      } catch (e) {
        return textResult({ ok: false, error: `Preview failed: ${(e as Error).message}` }, true);
      }
    },
  );

  server.registerTool(
    "agent_video_get_video",
    {
      title: "Get a previewed video's status",
      description: 'Get the status of a previewed video by id (from agent_video_preview). Returns { "videoId": string, "status": "success"|"not_found", "watchUrl"?: string }.',
      inputSchema: { videoId: z.string().min(1).describe("The 32-char video id from agent_video_render / agent_video_preview.") },
      outputSchema: { videoId: z.string(), status: z.enum(["success", "not_found"]), watchUrl: z.string().optional() },
      annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: false },
    },
    async ({ videoId }) => {
      const handle = previews.get(videoId);
      if (!handle) return textResult({ videoId, status: "not_found" });
      return textResult({ videoId, status: "success", watchUrl: handle.watchUrl });
    },
  );

  return { server, previews };
}
