import { test, expect } from "bun:test";
import { readFileSync } from "node:fs";
import { loadImage } from "@napi-rs/canvas";
import { AGENT_LOGO_IDS, resolveAgentLogo } from "../src/hyperframe/agent-logos.ts";

test("every shipped agent mark resolves to a loadable embedded SVG", async () => {
  expect(AGENT_LOGO_IDS.length).toBeGreaterThanOrEqual(6);
  for (const id of AGENT_LOGO_IDS) {
    const logo = resolveAgentLogo(id);
    expect(logo?.id).toBe(id);
    // Bytes, like the presenter loader: paths are virtual inside the compiled binary.
    const image = await loadImage(readFileSync(logo!.path));
    expect(image.width).toBeGreaterThan(0);
  }
});

test("model names and vendor aliases resolve case- and space-insensitively", () => {
  expect(resolveAgentLogo("Claude")?.id).toBe("claude-code");
  expect(resolveAgentLogo("Claude Code")?.id).toBe("claude-code");
  expect(resolveAgentLogo("Anthropic")?.id).toBe("claude-code");
  expect(resolveAgentLogo("OpenAI")?.id).toBe("codex");
  expect(resolveAgentLogo("Codex")?.id).toBe("codex");
  expect(resolveAgentLogo("gemini")?.id).toBe("gemini");
});

test("unknown models resolve to no built-in mark (monogram fallback)", () => {
  expect(resolveAgentLogo("Llama")).toBeUndefined();
  expect(resolveAgentLogo(undefined)).toBeUndefined();
  expect(resolveAgentLogo("  ")).toBeUndefined();
});
