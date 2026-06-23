/**
 * Repo reading — the local moat. Code/diff scenes reference the repo; the
 * renderer reads the LIVE bytes here so rendered code == source bytes. The LLM
 * never pastes source into the spec.
 */
import { readFileSync } from "node:fs";
import { execFileSync } from "node:child_process";
import { join, isAbsolute, extname } from "node:path";
import type { CodeScene, DiffScene } from "./spec.ts";

const EXT_LANG: Record<string, string> = {
  ".ts": "typescript", ".tsx": "tsx", ".js": "javascript", ".jsx": "jsx",
  ".mjs": "javascript", ".cjs": "javascript", ".json": "json", ".py": "python",
  ".go": "go", ".rs": "rust", ".rb": "ruby", ".java": "java", ".c": "c",
  ".h": "c", ".cpp": "cpp", ".cc": "cpp", ".cs": "csharp", ".php": "php",
  ".swift": "swift", ".kt": "kotlin", ".sh": "bash", ".bash": "bash",
  ".zsh": "bash", ".yml": "yaml", ".yaml": "yaml", ".toml": "toml",
  ".md": "markdown", ".css": "css", ".html": "html", ".sql": "sql", ".vue": "vue",
};

export function inferLanguage(file: string): string {
  return EXT_LANG[extname(file).toLowerCase()] ?? "text";
}

/** Read a file's full text, either from a git ref or the working tree. */
export function readFileAtRef(repoPath: string, file: string, ref?: string): string {
  if (ref) {
    // `git show <ref>:<path>` — path must be repo-relative and posix-style.
    return execFileSync("git", ["-C", repoPath, "show", `${ref}:${file}`], {
      encoding: "utf-8",
      maxBuffer: 64 * 1024 * 1024,
    });
  }
  const abs = isAbsolute(file) ? file : join(repoPath, file);
  return readFileSync(abs, "utf-8");
}

export interface ResolvedCode {
  /** Exact source text for the requested range (== source bytes). */
  text: string;
  language: string;
  /** 1-based first line number of `text` within the file. */
  startLine: number;
  endLine: number;
  /** Focus line numbers (1-based, absolute) to emphasize. */
  focus: number[];
}

/** Resolve a code scene's reference to its exact live source slice. */
export function resolveCodeRef(repoPath: string, content: CodeScene["content"]): ResolvedCode {
  const full = readFileAtRef(repoPath, content.file, content.ref);
  const lines = full.split("\n");
  const start = content.lineStart ?? 1;
  const end = content.lineEnd ?? lines.length;
  if (start < 1 || end < start) {
    throw new Error(`Invalid line range ${start}-${end} for ${content.file}`);
  }
  const slice = lines.slice(start - 1, end).join("\n");
  return {
    text: slice,
    language: content.language ?? inferLanguage(content.file),
    startLine: start,
    endLine: Math.min(end, lines.length),
    focus: content.focus ?? [],
  };
}

// ---------------------------------------------------------------------------
// Diff resolution — read the real `git diff`, never a pasted diff.
// ---------------------------------------------------------------------------

export type DiffLineKind = "add" | "del" | "context" | "hunk";

export interface DiffLine {
  kind: DiffLineKind;
  content: string;
  oldNo?: number;
  newNo?: number;
}

export interface ResolvedDiff {
  file: string;
  language: string;
  lines: DiffLine[];
  added: number;
  removed: number;
  /** The exact `git diff` text (for content-hashing / verification). */
  rawText: string;
}

/** Resolve a diff scene to the live `git diff` for its file + ref range. */
export function resolveDiff(repoPath: string, content: DiffScene["content"]): ResolvedDiff {
  const rawText = execFileSync(
    "git",
    ["-C", repoPath, "diff", "--no-color", content.ref, "--", content.file],
    { encoding: "utf-8", maxBuffer: 64 * 1024 * 1024 },
  );

  const lines: DiffLine[] = [];
  let added = 0;
  let removed = 0;
  let oldNo = 0;
  let newNo = 0;
  let inHunk = false;

  for (const raw of rawText.split("\n")) {
    if (raw.startsWith("@@")) {
      const m = raw.match(/@@ -(\d+)(?:,\d+)? \+(\d+)(?:,\d+)? @@(.*)/);
      if (m) {
        oldNo = parseInt(m[1]!, 10);
        newNo = parseInt(m[2]!, 10);
        inHunk = true;
        lines.push({ kind: "hunk", content: (m[3] ?? "").trim() });
      }
      continue;
    }
    if (!inHunk) continue; // skip the diff --git / index / +++ / --- preamble
    if (raw.startsWith("\\")) continue; // "\ No newline at end of file"
    const marker = raw[0];
    const text = raw.slice(1);
    if (marker === "+") {
      lines.push({ kind: "add", content: text, newNo });
      newNo++;
      added++;
    } else if (marker === "-") {
      lines.push({ kind: "del", content: text, oldNo });
      oldNo++;
      removed++;
    } else if (marker === " ") {
      lines.push({ kind: "context", content: text, oldNo, newNo });
      oldNo++;
      newNo++;
    }
  }

  return { file: content.file, language: inferLanguage(content.file), lines, added, removed, rawText };
}
