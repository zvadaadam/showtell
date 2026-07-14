import { test, expect, beforeAll, afterAll } from "bun:test";
import { chromium, type Page } from "playwright";
import { existsSync, mkdtempSync, rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import type { VideoSpec } from "@showtell/core";
import { renderVideo, startPreviewServer, resolvePlayerDist, type PreviewHandle } from "../src/index.ts";

// WEB gate (close-the-loop): render → serve the real player → drive it in a real
// headless browser (Playwright), since the Claude Chrome extension isn't available
// here. Requires the player to be built (packages/player/dist/client); skipped if
// it isn't, so a fresh checkout's `bun test` stays green.
let playerDir: string | null = null;
try {
  playerDir = resolvePlayerDist();
} catch {
  playerDir = null;
}
const browserAvailable = existsSync(chromium.executablePath());
const webGateAvailable = playerDir !== null && browserAvailable;

const outDir = mkdtempSync(join(tmpdir(), "showtell-web-test-"));
let handle: PreviewHandle | undefined;

beforeAll(async () => {
  if (!webGateAvailable || !playerDir) return;
  const spec: VideoSpec = {
    meta: {
      title: "Web Gate",
      fps: 30,
      aspectRatios: ["16:9"],
      watermark: true,
      tts: { provider: "say" },
      repo: { path: "." },
    },
    scenes: [{ kind: "title", content: { heading: "Hello" }, narration: "one two three four.", duration: "auto" }],
  };
  await renderVideo(spec, { repoPath: ".", outDir, baseName: "web", aspectRatios: ["16:9"] });
  handle = startPreviewServer({
    bundleDir: outDir,
    playerDir,
    title: spec.meta.title,
    videoId: "webgate000000000000000000000abcd",
  });
}, 90_000);

afterAll(async () => {
  handle?.stop();
  rmSync(outDir, { recursive: true, force: true });
});

async function assertPlayerPlayback(page: Page): Promise<void> {
  const res = await page.goto(handle!.watchUrl, { waitUntil: "load" });
  expect(res?.status()).toBe(200);

  // the player renders and loads the bundle's manifest → title comes from it
  await page.getByTestId("video").waitFor({ state: "visible", timeout: 20_000 });
  const titleText = (await page.getByTestId("title").textContent())?.trim();
  expect(titleText).toBe("Web Gate");

  await page.waitForFunction(
    () => {
      const v = document.querySelector("video");
      return !!v && v.readyState >= 1 && v.videoWidth > 0;
    },
    { timeout: 20_000 },
  );

  const startedAt = await page.evaluate(async () => {
    const v = document.querySelector("video") as HTMLVideoElement;
    v.muted = true;
    const currentTime = v.currentTime;
    await v.play();
    return currentTime;
  });
  await page.waitForFunction(
    (start) => {
      const v = document.querySelector("video");
      return !!v && !v.paused && v.currentTime > start;
    },
    startedAt,
    { timeout: 10_000 },
  );

  const state = await page.evaluate(() => {
    const v = document.querySelector("video") as HTMLVideoElement;
    return { currentTime: v.currentTime, w: v.videoWidth, h: v.videoHeight };
  });
  expect(state.currentTime).toBeGreaterThan(startedAt); // actually playing
  expect(state.w).toBe(1920);
  expect(state.h).toBe(1080);

  const buf = await page.screenshot({ path: join(outDir, "webshot.png") });
  expect(buf.length).toBeGreaterThan(5000);
}

function isClosedBrowserTransport(error: unknown): boolean {
  return error instanceof Error && error.message.includes("Target page, context or browser has been closed");
}

test.skipIf(!webGateAvailable)(
  "served player loads the bundle, shows the manifest title, and the video plays",
  async () => {
    // Chromium can occasionally lose its transport while several renderer tests
    // launch pinned browsers in parallel. Retry only that infrastructure failure;
    // player/manifest/media assertion failures remain immediate test failures.
    for (let attempt = 0; attempt < 2; attempt += 1) {
      const browser = await chromium.launch({ headless: true });
      const context = await browser.newContext({ viewport: { width: 1320, height: 900 } });
      const page = await context.newPage();
      try {
        await assertPlayerPlayback(page);
        return;
      } catch (error) {
        if (attempt > 0 || !isClosedBrowserTransport(error)) throw error;
      } finally {
        await context.close().catch(() => undefined);
        await browser.close().catch(() => undefined);
      }
    }
  },
  90_000,
);
