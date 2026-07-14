/**
 * Built-in agent marks for renderer-owned presenter badges. Bundle-local
 * `meta.presenter.logo` assets always take precedence over these defaults.
 */
import claudeCode from "../assets/agent-logos/claude-code.svg" with { type: "file" };
import codex from "../assets/agent-logos/codex.svg" with { type: "file" };
import copilot from "../assets/agent-logos/copilot.svg" with { type: "file" };
import cursor from "../assets/agent-logos/cursor.svg" with { type: "file" };
import gemini from "../assets/agent-logos/gemini.svg" with { type: "file" };
import opencode from "../assets/agent-logos/opencode.svg" with { type: "file" };

const LOGOS: Record<string, string> = {
  "claude-code": claudeCode,
  codex,
  copilot,
  cursor,
  gemini,
  opencode,
};

const ALIASES: Record<string, string> = {
  claude: "claude-code",
  anthropic: "claude-code",
  openai: "codex",
  chatgpt: "codex",
  gpt: "codex",
  google: "gemini",
  "github-copilot": "copilot",
};

export interface AgentLogo {
  id: string;
  path: string;
}

export const AGENT_LOGO_IDS = Object.freeze(Object.keys(LOGOS).sort()) as readonly string[];

export function resolveAgentLogo(model: string | undefined): AgentLogo | undefined {
  if (!model) return undefined;
  const key = model.trim().toLowerCase().replace(/\s+/g, "-");
  const id = LOGOS[key] ? key : ALIASES[key];
  return id ? { id, path: LOGOS[id]! } : undefined;
}
