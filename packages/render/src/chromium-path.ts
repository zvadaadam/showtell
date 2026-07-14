import { basename, dirname, join } from "node:path";

/** Resolve Playwright's pinned headless-shell executable beside full Chromium. */
export function headlessShellExecutable(
  chromiumExecutable: string,
  revision: string,
  platform = process.platform,
  arch = process.arch,
): string {
  let chromiumRoot = dirname(chromiumExecutable);
  const rootName = `chromium-${revision}`;
  while (dirname(chromiumRoot) !== chromiumRoot && basename(chromiumRoot) !== rootName) {
    chromiumRoot = dirname(chromiumRoot);
  }
  if (basename(chromiumRoot) !== rootName) {
    throw new Error(`Playwright Chromium path is not inside ${rootName}: ${chromiumExecutable}`);
  }
  const shellRoot = join(dirname(chromiumRoot), `chromium_headless_shell-${revision}`);
  if (platform === "darwin") {
    return join(shellRoot, `chrome-headless-shell-mac-${arch === "arm64" ? "arm64" : "x64"}`, "chrome-headless-shell");
  }
  if (platform === "linux" && arch === "arm64") return join(shellRoot, "chrome-linux", "headless_shell");
  if (platform === "linux" && arch === "x64") {
    return join(shellRoot, "chrome-headless-shell-linux64", "chrome-headless-shell");
  }
  throw new Error(`Showtell has no bundled Chromium layout for ${platform}-${arch}.`);
}
