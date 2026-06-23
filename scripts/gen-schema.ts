#!/usr/bin/env bun
/** Regenerate packages/core/schema.json from the zod spec (single source of truth). */
import { writeFileSync } from "node:fs";
import { join } from "node:path";
import { videoSpecJsonSchema } from "@agent-video/core";

const out = join(import.meta.dir, "..", "packages", "core", "schema.json");
writeFileSync(out, JSON.stringify(videoSpecJsonSchema(), null, 2) + "\n");
process.stdout.write(JSON.stringify({ ok: true, wrote: out }, null, 2) + "\n");
