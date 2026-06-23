/** Generate the published JSON Schema from the zod spec (single source of truth). */
import { zodToJsonSchema } from "zod-to-json-schema";
import { VideoSpec } from "./spec.ts";

export function videoSpecJsonSchema(): Record<string, unknown> {
  return zodToJsonSchema(VideoSpec, {
    name: "VideoSpec",
    $refStrategy: "none",
  }) as Record<string, unknown>;
}
