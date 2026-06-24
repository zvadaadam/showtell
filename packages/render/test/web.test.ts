import { test, expect, beforeAll, afterAll } from "bun:test";
import { chromium, type Browser } from "playwright";
import { join } from "node:path";
import { tmpdir } from "node:os";
import type { VideoSpec } from "@agent-video/core";
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

const outDir = join(tmpdir(), "agent-video-web-test");
let handle: PreviewHandle | undefined;
let browser: Browser | undefined;

beforeAll(async () => {
  if (!playerDir) return;
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
  browser = await chromium.launch({ headless: true });
}, 90_000);

afterAll(async () => {
  await browser?.close();
  handle?.stop();
});

test.skipIf(playerDir === null)(
  "served player loads the bundle, shows the manifest title, and the video plays",
  async () => {
    const page = await browser!.newPage({ viewport: { width: 1320, height: 900 } });

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

    await page.evaluate(async () => {
      const v = document.querySelector("video") as HTMLVideoElement;
      v.muted = true;
      await v.play();
    });
    await page.waitForTimeout(800);

    const state = await page.evaluate(() => {
      const v = document.querySelector("video") as HTMLVideoElement;
      return { currentTime: v.currentTime, w: v.videoWidth, h: v.videoHeight };
    });
    expect(state.currentTime).toBeGreaterThan(0); // actually playing
    expect(state.w).toBe(1920);
    expect(state.h).toBe(1080);

    const buf = await page.screenshot({ path: join(outDir, "webshot.png") });
    expect(buf.length).toBeGreaterThan(5000);

    await page.close();
  },
  60_000,
);
