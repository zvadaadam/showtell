#!/usr/bin/env bun
/** Regenerate packages/core/*.schema.json from the zod schemas (single source of truth). */
import { writeFileSync } from "node:fs";
import { join } from "node:path";
import { videoSpecJsonSchema, videoManifestJsonSchema } from "@agent-video/core";

const coreDir = join(import.meta.dir, "..", "packages", "core");
const specOut = join(coreDir, "schema.json");
const manifestOut = join(coreDir, "manifest.schema.json");

writeFileSync(specOut, JSON.stringify(videoSpecJsonSchema(), null, 2) + "\n");
writeFileSync(manifestOut, JSON.stringify(videoManifestJsonSchema(), null, 2) + "\n");

process.stdout.write(JSON.stringify({ ok: true, wrote: [specOut, manifestOut] }, null, 2) + "\n");
