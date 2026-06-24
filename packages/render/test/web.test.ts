import { test, expect, beforeAll, afterAll } from "bun:test";
import { chromium, type Browser } from "playwright";
import { mkdirSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import type { VideoSpec } from "@agent-video/core";
import { renderVideo, startPreviewServer, type PreviewHandle } from "../src/index.ts";

// WEB gate (DONE): preview loads, plays, screenshot asserts — verified with a
// real headless browser (Playwright chromium) since the Claude Chrome extension
// isn't available in this environment.

const outDir = join(tmpdir(), "agent-video-web-test");
let handle: PreviewHandle;
let browser: Browser;

beforeAll(async () => {
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
  const r = await renderVideo(spec, { repoPath: ".", outDir, baseName: "web", aspectRatios: ["16:9"] });
  handle = startPreviewServer({
    outputs: r.outputs,
    title: spec.meta.title,
    videoId: "webgate000000000000000000000abcd",
  });
  browser = await chromium.launch({ headless: true });
}, 90_000);

afterAll(async () => {
  await browser?.close();
  handle?.stop();
});

test("preview page loads, the video plays, and a non-blank screenshot is captured", async () => {
  const page = await browser.newPage({ viewport: { width: 1280, height: 800 } });

  const res = await page.goto(handle.watchUrl, { waitUntil: "load" });
  expect(res?.status()).toBe(200);
  expect(await page.title()).toContain("Web Gate");

  // the player exists and loads the mp4
  expect(await page.locator("video#player").count()).toBe(1);
  await page.waitForFunction(
    () => {
      const v = document.querySelector("video");
      return !!v && v.readyState >= 1 && v.videoWidth > 0;
    },
    { timeout: 20_000 },
  );

  // play it
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
  expect(state.currentTime).toBeGreaterThan(0); // it is actually playing
  expect(state.w).toBe(1920);
  expect(state.h).toBe(1080);

  // screenshot asserts — saved for the human to eyeball
  mkdirSync(outDir, { recursive: true });
  const buf = await page.screenshot({ path: join(outDir, "webshot.png") });
  expect(buf.length).toBeGreaterThan(5000);

  await page.close();
}, 60_000);
