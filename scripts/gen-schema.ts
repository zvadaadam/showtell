#!/usr/bin/env bun
/** Regenerate generated artifacts: packages/core/*.schema.json (from zod) and the
 * embedded hyperframes SDK source (packages/render/src/hyperframes-sdk.source.txt —
 * bundled into the compiled binary so `bundle render` works outside the repo). */
import { readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { bundleSpecJsonSchema, videoSpecJsonSchema, videoManifestJsonSchema } from "@agent-video/core";

const root = join(import.meta.dir, "..");
const coreDir = join(root, "packages", "core");
const specOut = join(coreDir, "schema.json");
const manifestOut = join(coreDir, "manifest.schema.json");
const bundleOut = join(coreDir, "bundle.schema.json");
const sdkSource = join(root, "packages", "hyperframes", "src", "index.ts");
const sdkOut = join(root, "packages", "render", "src", "hyperframes-sdk.source.txt");

writeFileSync(specOut, JSON.stringify(videoSpecJsonSchema(), null, 2) + "\n");
writeFileSync(manifestOut, JSON.stringify(videoManifestJsonSchema(), null, 2) + "\n");
writeFileSync(bundleOut, JSON.stringify(bundleSpecJsonSchema(), null, 2) + "\n");
writeFileSync(sdkOut, readFileSync(sdkSource, "utf-8"));

process.stdout.write(JSON.stringify({ ok: true, wrote: [specOut, manifestOut, bundleOut, sdkOut] }, null, 2) + "\n");
