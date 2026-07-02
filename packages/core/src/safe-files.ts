import { existsSync, lstatSync, realpathSync, statSync } from "node:fs";
import { dirname, isAbsolute, relative, resolve } from "node:path";

export type SafeFileErrorCode = "ABSOLUTE_PATH" | "PATH_ESCAPE" | "MISSING_FILE" | "SYMLINK" | "NOT_FILE" | "TOO_LARGE";

export class SafeFileError extends Error {
  readonly code: SafeFileErrorCode;

  constructor(code: SafeFileErrorCode, message: string) {
    super(message);
    this.code = code;
  }
}

function isInside(root: string, child: string): boolean {
  const rel = relative(root, child);
  return rel === "" || (!rel.startsWith("..") && !isAbsolute(rel));
}

export function resolveRelativePath(rootInput: string, rel: string): string {
  if (isAbsolute(rel)) throw new SafeFileError("ABSOLUTE_PATH", "absolute paths are not allowed");
  const root = resolve(rootInput);
  const abs = resolve(root, rel);
  if (!isInside(root, abs)) throw new SafeFileError("PATH_ESCAPE", "path escapes root");
  return abs;
}

export function safeExistingFileInRoot(
  rootInput: string,
  rel: string,
  opts: { maxBytes?: number } = {},
): { path: string; bytes: number } {
  const abs = resolveRelativePath(rootInput, rel);
  if (!existsSync(abs)) throw new SafeFileError("MISSING_FILE", "file does not exist");

  const direct = lstatSync(abs);
  if (direct.isSymbolicLink()) throw new SafeFileError("SYMLINK", "file must not be a symlink");
  if (!direct.isFile()) throw new SafeFileError("NOT_FILE", "path must be a regular file");

  const rootReal = realpathSync(rootInput);
  const fileReal = realpathSync(abs);
  if (!isInside(rootReal, fileReal)) throw new SafeFileError("PATH_ESCAPE", "real path escapes root");

  const bytes = statSync(abs).size;
  if (opts.maxBytes !== undefined && bytes > opts.maxBytes) {
    throw new SafeFileError("TOO_LARGE", `file is too large (${bytes} bytes > ${opts.maxBytes} bytes)`);
  }
  return { path: abs, bytes };
}

export function assertSafeOutputPath(rootInput: string, outputPathInput: string): string {
  const rootReal = realpathSync(rootInput);
  const abs = resolve(outputPathInput);
  const parentReal = realpathSync(dirname(abs));
  if (!isInside(rootReal, parentReal)) throw new SafeFileError("PATH_ESCAPE", "output path escapes root");

  if (existsSync(abs)) {
    const current = lstatSync(abs);
    if (current.isSymbolicLink()) throw new SafeFileError("SYMLINK", "output must not replace a symlink");
    if (!current.isFile()) throw new SafeFileError("NOT_FILE", "output path must be a regular file");
  }
  return abs;
}
