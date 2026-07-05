/**
 * Built-in agent marks for the presenter badge, shipped with the renderer so a
 * spec only needs `meta.presenter.model: "claude"` — no logo files to copy into
 * every bundle. The SVGs are 100×100 dark-tile marks (sourced from skills.sh)
 * imported as bundled assets, so they survive `bun build --compile` exactly
 * like the pinned fonts. A bundle-local `meta.presenter.logo` always wins.
 */
import claudeCode from "../../assets/agent-logos/claude-code.svg" with { type: "file" };
import codex from "../../assets/agent-logos/codex.svg" with { type: "file" };
import copilot from "../../assets/agent-logos/copilot.svg" with { type: "file" };
import cursor from "../../assets/agent-logos/cursor.svg" with { type: "file" };
import gemini from "../../assets/agent-logos/gemini.svg" with { type: "file" };
import opencode from "../../assets/agent-logos/opencode.svg" with { type: "file" };

const LOGOS: Record<string, string> = {
  "claude-code": claudeCode,
  codex,
  copilot,
  cursor,
  gemini,
  opencode,
};

/** Exact-match aliases only — vendor and product names agents actually write. */
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
  /** Canonical logo id (e.g. "claude-code"), recorded in the compiled plan. */
  id: string;
  /** Filesystem path of the embedded SVG asset. */
  path: string;
}

export const AGENT_LOGO_IDS = Object.freeze(Object.keys(LOGOS).sort()) as readonly string[];

/** Resolve a presenter `model` name to a built-in agent mark, if we ship one. */
export function resolveAgentLogo(model: string | undefined): AgentLogo | undefined {
  if (!model) return undefined;
  const key = model.trim().toLowerCase().replace(/\s+/g, "-");
  const id = LOGOS[key] ? key : ALIASES[key];
  return id ? { id, path: LOGOS[id]! } : undefined;
}
