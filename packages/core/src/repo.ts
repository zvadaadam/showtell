/**
 * Repo reading — the local moat. Code/diff scenes reference the repo; the
 * renderer reads the LIVE bytes here so rendered code == source bytes. The LLM
 * never pastes source into the spec.
 */
import { readFileSync, realpathSync } from "node:fs";
import { execFileSync } from "node:child_process";
import { extname, isAbsolute, normalize } from "node:path";
import type { CodeScene, DiffScene } from "./spec.ts";
import { SafeFileError, safeExistingFileInRoot } from "./safe-files.ts";

const EXT_LANG: Record<string, string> = {
  ".ts": "typescript",
  ".tsx": "tsx",
  ".js": "javascript",
  ".jsx": "jsx",
  ".mjs": "javascript",
  ".cjs": "javascript",
  ".json": "json",
  ".py": "python",
  ".go": "go",
  ".rs": "rust",
  ".rb": "ruby",
  ".java": "java",
  ".c": "c",
  ".h": "c",
  ".cpp": "cpp",
  ".cc": "cpp",
  ".cs": "csharp",
  ".php": "php",
  ".swift": "swift",
  ".kt": "kotlin",
  ".sh": "bash",
  ".bash": "bash",
  ".zsh": "bash",
  ".yml": "yaml",
  ".yaml": "yaml",
  ".toml": "toml",
  ".md": "markdown",
  ".css": "css",
  ".html": "html",
  ".sql": "sql",
  ".vue": "vue",
};

export function inferLanguage(file: string): string {
  return EXT_LANG[extname(file).toLowerCase()] ?? "text";
}

/** Normalize and validate an agent-authored file ref as repo-relative. */
export function repoRelativeFile(file: string): string {
  if (isAbsolute(file)) {
    throw new Error(`Repo file must be relative, got absolute path: ${file}`);
  }
  const normalized = normalize(file).replaceAll("\\", "/");
  const parts = normalized.split("/");
  if (normalized === "." || normalized === ".." || normalized.startsWith("../") || parts.includes("..")) {
    throw new Error(`Repo file must stay inside the repo, got: ${file}`);
  }
  return normalized;
}

function assertSafeGitRef(ref: string): void {
  if (ref.startsWith("-")) throw new Error(`Git ref/range must not start with "-": ${ref}`);
  if (/[\s\u007f:]/.test(ref)) {
    throw new Error(`Git ref/range contains unsupported control, whitespace, or ":" characters: ${ref}`);
  }
}

function safeWorkingTreeFile(repoPath: string, file: string): string {
  const rel = repoRelativeFile(file);
  let realRepoPath: string;
  try {
    realRepoPath = realpathSync(repoPath);
  } catch (e) {
    throw new Error(`Unsafe working-tree file "${file}": repo path is not readable: ${(e as Error).message}`);
  }
  try {
    return safeExistingFileInRoot(realRepoPath, rel, { maxBytes: 64 * 1024 * 1024 }).path;
  } catch (e) {
    if (e instanceof SafeFileError) throw new Error(`Unsafe working-tree file "${file}": ${e.message}`);
    throw e;
  }
}

/** Read a file's full text, either from a git ref or the working tree. */
export function readFileAtRef(repoPath: string, file: string, ref?: string): string {
  const rel = repoRelativeFile(file);
  if (ref) {
    assertSafeGitRef(ref);
    // Requires Git 2.24+ for `--end-of-options`; path must be repo-relative and posix-style.
    return execFileSync("git", ["-C", repoPath, "show", "--end-of-options", `${ref}:${rel}`], {
      encoding: "utf-8",
      maxBuffer: 64 * 1024 * 1024,
    });
  }
  return readFileSync(safeWorkingTreeFile(repoPath, rel), "utf-8");
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
  const lines = full.endsWith("\n") ? full.slice(0, -1).split("\n") : full.split("\n");
  const start = content.lineStart ?? 1;
  const end = content.lineEnd ?? lines.length;
  if (start < 1 || end < start) {
    throw new Error(`Invalid line range ${start}-${end} for ${content.file}`);
  }
  if (start > lines.length) {
    throw new Error(`Line range ${start}-${end} starts past end of ${content.file} (${lines.length} line(s)).`);
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
  const file = repoRelativeFile(content.file);
  assertSafeGitRef(content.ref);
  const rawText = execFileSync(
    "git",
    ["-C", repoPath, "diff", "--no-color", "--end-of-options", content.ref, "--", file],
    {
      encoding: "utf-8",
      maxBuffer: 64 * 1024 * 1024,
    },
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

  return { file, language: inferLanguage(file), lines, added, removed, rawText };
}

// ---------------------------------------------------------------------------
// Repo metadata — commit/branch for the manifest. Best-effort: a non-git path
// (or any git failure) yields an empty object rather than throwing.
// ---------------------------------------------------------------------------

export interface RepoMeta {
  commit?: string;
  branch?: string;
}

/** Read best-effort git identity for a repo path. Never throws. */
export function readRepoMeta(repoPath: string): RepoMeta {
  const git = (args: string[]): string | undefined => {
    try {
      const out = execFileSync("git", ["-C", repoPath, ...args], {
        encoding: "utf-8",
        stdio: ["ignore", "pipe", "ignore"],
      }).trim();
      return out || undefined;
    } catch {
      return undefined;
    }
  };
  return {
    commit: git(["rev-parse", "HEAD"]),
    branch: git(["rev-parse", "--abbrev-ref", "HEAD"]),
  };
}
