/**
 * agent-video MCP server. Agent-first (per the mcp-builder best practices):
 * service-prefixed snake_case tool names, rich descriptions with examples,
 * Zod input + output schemas, structured results, actionable errors with hints,
 * and tool annotations. Reuses the same @agent-video/render packages as the CLI
 * (rendering logic is never forked).
 */
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import { validateSpec, videoSpecJsonSchema, specContentId, type VideoSpec } from "@agent-video/core";
import { renderVideo, startPreviewServer, resolvePlayerDist, type PreviewHandle } from "@agent-video/render";
import {
  analyzeCaptureWorkflow,
  execCapturedCommandWorkflow,
  importCaptureWorkflow,
  normalizeCaptureEvents,
  recordCaptureEvent,
  loadSessionEvents,
  startExternalCaptureWorkflow,
  stopExternalCaptureWorkflow,
} from "@agent-video/capture";

const SPEC_EXAMPLE = `{
  "meta": { "title": "PR: idempotency keys", "aspectRatios": ["16:9","9:16"], "repo": { "path": "." } },
  "scenes": [
    { "kind": "title", "content": { "heading": "Idempotency keys" }, "narration": "This PR makes the webhook safe to retry.", "duration": "auto" },
    { "kind": "diff", "content": { "file": "src/webhook.ts", "ref": "main..HEAD" }, "narration": "We check the key before processing.", "duration": "auto" }
  ]
}`;

const ASPECT = z.enum(["16:9", "9:16", "1:1"]);
const CAPTURE_EVENT_TYPE = z.enum(["click", "type", "scroll", "navigate", "idle"]);
const CAPTURE_EXEC_EVENT_TYPE = z.enum(["auto", "none", "click", "type", "scroll", "navigate", "idle"]);

/** Shared error-detail shape for output schemas (mirrors validateSpec's errors). */
const ERROR_DETAIL = z.object({ path: z.string(), message: z.string(), hint: z.string().optional() });
const OUTPUT_Ref = z.object({ aspectRatio: z.string(), path: z.string(), durationMs: z.number().optional() });
const CAPTURE_EVENT = z.object({
  t: z.number(),
  type: CAPTURE_EVENT_TYPE,
  x: z.number(),
  y: z.number(),
  startT: z.number().optional(),
  endT: z.number().optional(),
});

function textResult(
  data: unknown,
  isError = false,
): { content: { type: "text"; text: string }[]; structuredContent?: Record<string, unknown>; isError?: true } {
  const out: {
    content: { type: "text"; text: string }[];
    structuredContent?: Record<string, unknown>;
    isError?: true;
  } = {
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
      return textResult({
        ok: true,
        sceneCount: r.spec.scenes.length,
        kinds: r.spec.scenes.map((s) => s.kind),
        warnings: r.warnings,
      });
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
        repoPath: z
          .string()
          .optional()
          .describe("Repo root for resolving file:line / git refs. Default: spec.meta.repo.path."),
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
        return textResult({
          ok: true,
          videoId: specContentId(r.spec),
          outputs: result.outputs,
          scenes: result.scenes,
          skipped: result.skipped,
          warnings: result.warnings,
        });
      } catch (e) {
        return textResult(
          {
            ok: false,
            error: `Render failed: ${(e as Error).message}`,
            hint: "Check file/line refs, repo path, and that ffmpeg is installed.",
          },
          true,
        );
      }
    },
  );

  server.registerTool(
    "agent_video_preview",
    {
      title: "Render and serve a watch page",
      description: `Render the spec, then serve the web player at a localhost watch URL (the bundle is served alongside it). Returns { videoId, status:"success", watchUrl } immediately; the server keeps running. Use agent_video_get_video to re-check. The player must be built once (cd packages/player && bun --bun run build).

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
        manifestPath: z.string().optional(),
        outputs: z.array(OUTPUT_Ref).optional(),
        warnings: z.array(z.object({ scene: z.number(), message: z.string() })).optional(),
        error: z.string().optional(),
        errors: z.array(ERROR_DETAIL).optional(),
        hint: z.string().optional(),
      },
      // Starts a long-lived local server + writes files; local-only.
      annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: false, openWorldHint: false },
    },
    async ({ spec, repoPath, port }) => {
      const r = validateSpec(spec);
      if (!r.ok) return textResult({ ok: false, error: "Spec failed validation.", errors: r.errors }, true);
      try {
        const videoId = specContentId(r.spec);
        const playerDir = resolvePlayerDist();
        const outDir = ".agent-video/out";
        const result = await renderVideo(r.spec as VideoSpec, {
          repoPath: repoPath ?? r.spec.meta.repo.path,
          outDir,
          baseName: "video",
        });
        const handle = startPreviewServer({ bundleDir: outDir, playerDir, title: r.spec.meta.title, videoId, port });
        previews.set(videoId, handle);
        return textResult({
          ok: true,
          videoId,
          status: "success",
          watchUrl: handle.watchUrl,
          manifestPath: result.manifestPath,
          outputs: result.outputs,
          warnings: result.warnings,
        });
      } catch (e) {
        return textResult(
          {
            ok: false,
            error: `Preview failed: ${(e as Error).message}`,
            hint: "If the player isn't built: cd packages/player && bun --bun run build.",
          },
          true,
        );
      }
    },
  );

  server.registerTool(
    "agent_video_import_capture",
    {
      title: "Import a browser recording as a capture session",
      description: `Import an agent-browser .webm/mp4 recording into the sandboxed capture store used by screencap scenes. This transcodes the source to .agent-video/captures/<sessionId>.mp4; specs still reference only sessionRef, never raw file paths.

For ScreenStudio-style smart playback, pass eventsPath with JSON shaped as [{ "t": 1200, "type": "click", "x": 640, "y": 360 }] for better camera targets, or omit events and let playback.mode="smart" trim visually idle time.

Example:
  agent-browser record start ./demo.webm
  ...
  agent-browser record stop
  agent_video_import_capture({ "sourcePath": "./demo.webm", "sessionId": "demo", "eventsPath": "./demo.events.json" })
Then in spec: { "kind": "screencap", "content": { "source": "browser", "sessionRef": "demo", "playback": { "mode": "smart" } }, "narration": "...", "duration": "auto" }`,
      inputSchema: {
        sourcePath: z.string().min(1).describe("Path to the agent-browser recording (.webm or mp4)."),
        sessionId: z
          .string()
          .regex(/^[A-Za-z0-9_-]{1,64}$/)
          .describe("Capture session id; becomes .agent-video/captures/<sessionId>.mp4."),
        repoPath: z.string().optional().describe("Repo root containing .agent-video/captures. Default: ."),
        eventsPath: z.string().optional().describe("Optional JSON file containing [{t,type,x,y}] event sidecar data."),
      },
      outputSchema: {
        ok: z.boolean(),
        sessionId: z.string().optional(),
        path: z.string().optional(),
        bytes: z.number().optional(),
        eventCount: z.number().optional(),
        error: z.string().optional(),
        hint: z.string().optional(),
      },
      annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: false, openWorldHint: false },
    },
    async ({ sourcePath, sessionId, repoPath, eventsPath }) => {
      try {
        return textResult(importCaptureWorkflow({ id: sessionId, sourcePath, root: repoPath ?? ".", eventsPath }));
      } catch (e) {
        return textResult(
          {
            ok: false,
            error: `Capture import failed: ${(e as Error).message}`,
            hint: "Pass a readable agent-browser .webm/mp4 and optional events JSON shaped as [{t,type,x,y}].",
          },
          true,
        );
      }
    },
  );

  server.registerTool(
    "agent_video_analyze_capture",
    {
      title: "Analyze visual activity in a capture",
      description: `Inspect a capture for pixel activity so a screencap scene can use playback.mode="smart" even when no browser/device/computer-use event sidecar exists.

Use this before rendering if you want proof that the raw recording contains trimmable activity.

Example:
  agent_video_analyze_capture({ "sessionId": "demo" })
Then in spec: { "kind": "screencap", "content": { "source": "browser", "sessionRef": "demo", "playback": { "mode": "smart" } }, "narration": "...", "duration": "auto" }`,
      inputSchema: {
        sessionId: z
          .string()
          .regex(/^[A-Za-z0-9_-]{1,64}$/)
          .optional()
          .describe("Capture session id under .agent-video/captures."),
        sourcePath: z.string().optional().describe("Direct mp4/webm path to analyze instead of a session id."),
        repoPath: z.string().optional().describe("Repo root containing .agent-video/captures. Default: ."),
        sourceStartSec: z.number().min(0).optional(),
        sourceDurationSec: z.number().positive().optional(),
        sampleFps: z.number().int().min(1).max(12).optional(),
        visualMinScore: z.number().min(0).max(50).optional(),
      },
      outputSchema: {
        ok: z.boolean(),
        sourcePath: z.string().optional(),
        sampleCount: z.number().optional(),
        sampleFps: z.number().optional(),
        intervalCount: z.number().optional(),
        intervals: z.array(z.record(z.unknown())).optional(),
        suggestedEvents: z.array(CAPTURE_EVENT).optional(),
        error: z.string().optional(),
        hint: z.string().optional(),
      },
      annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: false },
    },
    async ({ sessionId, sourcePath, repoPath, sourceStartSec, sourceDurationSec, sampleFps, visualMinScore }) => {
      try {
        const result = analyzeCaptureWorkflow({
          id: sessionId,
          sourcePath,
          root: repoPath ?? ".",
          sourceStartSec,
          sourceDurationSec,
          sampleFps,
          visualMinScore,
        });
        return textResult(result, !result.ok);
      } catch (e) {
        return textResult(
          {
            ok: false,
            error: `Capture analyze failed: ${(e as Error).message}`,
            hint: "Check that ffmpeg can decode the capture.",
          },
          true,
        );
      }
    },
  );

  server.registerTool(
    "agent_video_capture_start_external",
    {
      title: "Start tracking an external recorder",
      description: `Start an agent-video capture session around an external recorder without reimplementing that recorder. Optionally runs a real record-start command first, then stores timing state for later agent_video_capture_exec_cli calls.

Example:
  agent_video_capture_start_external({
    "sessionId": "demo",
    "sourcePath": "./demo.webm",
    "command": ["agent-browser", "record", "start", "./demo.webm"]
  })`,
      inputSchema: {
        sessionId: z.string().regex(/^[A-Za-z0-9_-]{1,64}$/),
        sourcePath: z.string().min(1).describe("The raw recording path produced by the external recorder."),
        repoPath: z.string().optional().describe("Repo root containing .agent-video/captures. Default: ."),
        driver: z.string().optional().describe("Optional driver label, e.g. agent-browser or agent-device."),
        command: z.array(z.string()).optional().describe("Optional real CLI command to start recording."),
        timeoutMs: z
          .number()
          .int()
          .positive()
          .optional()
          .describe("Timeout for the optional command. Default: 120000."),
      },
      outputSchema: {
        ok: z.boolean(),
        sessionId: z.string().optional(),
        state: z.record(z.unknown()).optional(),
        command: z.record(z.unknown()).optional(),
        error: z.string().optional(),
        hint: z.string().optional(),
      },
      annotations: { readOnlyHint: false, destructiveHint: true, idempotentHint: false, openWorldHint: true },
    },
    async ({ sessionId, sourcePath, repoPath, driver, command, timeoutMs }) => {
      try {
        const result = startExternalCaptureWorkflow({
          id: sessionId,
          sourcePath,
          root: repoPath ?? ".",
          driver,
          command,
          timeoutMs,
        });
        return textResult(result, !result.ok);
      } catch (e) {
        return textResult(
          {
            ok: false,
            error: `Capture start-external failed: ${(e as Error).message}`,
            hint: "Use a valid sessionId and sourcePath.",
          },
          true,
        );
      }
    },
  );

  server.registerTool(
    "agent_video_capture_exec_cli",
    {
      title: "Run a real CLI action and record its capture event",
      description: `Execute a real external CLI command while a capture is active. agent-video records a command start/end window, infers a click/type/scroll/navigate event when possible, and records it only if the command exits 0.

This does not reimplement agent-browser, computer-use, CUA, or agent-device. It supervises the command and keeps structured stdout/stderr.

Examples:
  agent_video_capture_exec_cli({ "sessionId": "demo", "command": ["agent-browser", "click", "@e3"] })
  agent_video_capture_exec_cli({ "sessionId": "demo", "eventType": "click", "x": 120, "y": 300, "command": ["agent-device", "tap", "120", "300"] })`,
      inputSchema: {
        sessionId: z.string().regex(/^[A-Za-z0-9_-]{1,64}$/),
        command: z.array(z.string()).min(1).describe("The real CLI command to run."),
        repoPath: z.string().optional().describe("Repo root containing .agent-video/captures. Default: ."),
        eventType: CAPTURE_EXEC_EVENT_TYPE.optional().describe("auto infers from command; none records no event."),
        x: z.number().optional().describe("Required with explicit click/type/scroll/navigate/idle eventType."),
        y: z.number().optional().describe("Required with explicit click/type/scroll/navigate/idle eventType."),
        startedAtEpochMs: z.number().optional().describe("Override start time if no start-external state exists."),
        timeoutMs: z.number().int().positive().optional().describe("Timeout for the command. Default: 120000."),
      },
      outputSchema: {
        ok: z.boolean(),
        sessionId: z.string().optional(),
        exitCode: z.number().optional(),
        stdout: z.string().optional(),
        stderr: z.string().optional(),
        timedOut: z.boolean().optional(),
        command: z.record(z.unknown()).optional(),
        event: CAPTURE_EVENT.optional(),
        eventSource: z.string().optional(),
        eventCount: z.number().optional(),
        error: z.string().optional(),
        hint: z.string().optional(),
      },
      annotations: { readOnlyHint: false, destructiveHint: true, idempotentHint: false, openWorldHint: true },
    },
    async ({ sessionId, command, repoPath, eventType, x, y, startedAtEpochMs, timeoutMs }) => {
      try {
        const result = execCapturedCommandWorkflow({
          id: sessionId,
          root: repoPath ?? ".",
          command,
          eventType: eventType ?? "auto",
          x,
          y,
          startedAtEpochMs,
          timeoutMs,
        });
        return textResult(result, !result.ok);
      } catch (e) {
        return textResult(
          {
            ok: false,
            error: `Capture exec failed: ${(e as Error).message}`,
            hint: "Run start-external first, or pass eventType with x/y for tools that cannot be inferred.",
          },
          true,
        );
      }
    },
  );

  server.registerTool(
    "agent_video_capture_stop_external",
    {
      title: "Stop tracking an external recorder and import the video",
      description: `Stop an external recording session. Optionally runs a real record-stop command, marks the session stopped, and imports the raw recording into .agent-video/captures/<sessionId>.mp4.

Example:
  agent_video_capture_stop_external({ "sessionId": "demo", "command": ["agent-browser", "record", "stop"] })`,
      inputSchema: {
        sessionId: z.string().regex(/^[A-Za-z0-9_-]{1,64}$/),
        repoPath: z.string().optional().describe("Repo root containing .agent-video/captures. Default: ."),
        command: z.array(z.string()).optional().describe("Optional real CLI command to stop recording."),
        noImport: z.boolean().optional().describe("Only mark stopped; do not import the raw recording."),
        timeoutMs: z
          .number()
          .int()
          .positive()
          .optional()
          .describe("Timeout for the optional command. Default: 120000."),
      },
      outputSchema: {
        ok: z.boolean(),
        sessionId: z.string().optional(),
        state: z.record(z.unknown()).optional(),
        command: z.record(z.unknown()).optional(),
        imported: z.record(z.unknown()).optional(),
        eventCount: z.number().optional(),
        error: z.string().optional(),
        hint: z.string().optional(),
      },
      annotations: { readOnlyHint: false, destructiveHint: true, idempotentHint: false, openWorldHint: true },
    },
    async ({ sessionId, repoPath, command, noImport, timeoutMs }) => {
      try {
        const result = stopExternalCaptureWorkflow({
          id: sessionId,
          root: repoPath ?? ".",
          command,
          noImport,
          timeoutMs,
        });
        return textResult(result, !result.ok);
      } catch (e) {
        return textResult(
          {
            ok: false,
            error: `Capture stop-external failed: ${(e as Error).message}`,
            hint: "Ensure the raw recording exists and retry.",
          },
          true,
        );
      }
    },
  );

  server.registerTool(
    "agent_video_record_capture_event",
    {
      title: "Append an action event to a capture session",
      description: `Append one browser/app action event to a capture session sidecar. A browser MCP bridge can call this after click/type/scroll/navigate tools so screencap playback.mode="smart" knows where to zoom while visual analysis trims dead time.

Example:
  agent_video_record_capture_event({ "sessionId": "demo", "type": "click", "x": 640, "y": 360, "tMs": 1234 })`,
      inputSchema: {
        sessionId: z
          .string()
          .regex(/^[A-Za-z0-9_-]{1,64}$/)
          .describe("Capture session id created by capture/import."),
        type: CAPTURE_EVENT_TYPE.describe("Action type from the browser/app driver."),
        x: z.number().describe("Source-pixel x coordinate of the action."),
        y: z.number().describe("Source-pixel y coordinate of the action."),
        tMs: z.number().min(0).describe("Milliseconds since recording start."),
        repoPath: z.string().optional().describe("Repo root containing .agent-video/captures. Default: ."),
      },
      outputSchema: {
        ok: z.boolean(),
        sessionId: z.string().optional(),
        event: CAPTURE_EVENT.optional(),
        eventCount: z.number().optional(),
        error: z.string().optional(),
        hint: z.string().optional(),
      },
      annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: false, openWorldHint: false },
    },
    async ({ sessionId, type, x, y, tMs, repoPath }) => {
      try {
        const event = normalizeCaptureEvents([{ type, x, y, t: tMs }])[0]!;
        recordCaptureEvent(sessionId, repoPath ?? ".", event);
        return textResult({
          ok: true,
          sessionId,
          event,
          eventCount: loadSessionEvents(sessionId, repoPath ?? ".")?.length ?? 0,
        });
      } catch (e) {
        return textResult(
          {
            ok: false,
            error: `Capture event failed: ${(e as Error).message}`,
            hint: "Use type click|type|scroll|navigate|idle and numeric x/y/tMs values.",
          },
          true,
        );
      }
    },
  );

  server.registerTool(
    "agent_video_get_video",
    {
      title: "Get a previewed video's status",
      description:
        'Get the status of a previewed video by id (from agent_video_preview). Returns { "videoId": string, "status": "success"|"not_found", "watchUrl"?: string }.',
      inputSchema: {
        videoId: z.string().min(1).describe("The 32-char video id from agent_video_render / agent_video_preview."),
      },
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
