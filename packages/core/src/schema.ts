/** Generate the published JSON Schema from the zod spec (single source of truth). */
import { zodToJsonSchema } from "zod-to-json-schema";
import { VideoSpec } from "./spec.ts";
import { BundleSpec } from "./bundle.ts";

export function videoSpecJsonSchema(): Record<string, unknown> {
  return zodToJsonSchema(VideoSpec, {
    name: "VideoSpec",
    $refStrategy: "none",
  }) as Record<string, unknown>;
}

export function bundleSpecJsonSchema(): Record<string, unknown> {
  return zodToJsonSchema(BundleSpec, {
    name: "BundleSpec",
    $refStrategy: "none",
  }) as Record<string, unknown>;
}
