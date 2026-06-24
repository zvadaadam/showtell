import { test, expect, afterAll } from "bun:test";
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { startPreviewServer } from "../src/preview.ts";

// Fake a built player dir + a rendered bundle dir; the server just streams files.
const playerDir = mkdtempSync(join(tmpdir(), "av-player-"));
const bundleDir = mkdtempSync(join(tmpdir(), "av-bundle-"));
writeFileSync(join(playerDir, "_shell.html"), "<!doctype html><html><body><div id=root></div></body></html>");
mkdirSync(join(playerDir, "assets"), { recursive: true });
writeFileSync(join(playerDir, "assets", "app.js"), "console.log('player')");
writeFileSync(join(bundleDir, "manifest.json"), JSON.stringify({ version: 1 }));
writeFileSync(join(bundleDir, "video-16x9.mp4"), Buffer.from("not-a-real-mp4-but-bytes"));

const handle = startPreviewServer({ bundleDir, playerDir, title: "Preview Test", videoId: "abc123def456" });
const at = (p: string) => `http://localhost:${handle.port}${p}`;

afterAll(() => {
  handle.stop();
  rmSync(playerDir, { recursive: true, force: true });
  rmSync(bundleDir, { recursive: true, force: true });
});

test("serves the player shell at /", async () => {
  const res = await fetch(handle.url);
  expect(res.status).toBe(200);
  expect(res.headers.get("content-type")).toContain("text/html");
  expect(await res.text()).toContain("id=root");
});

test("serves hashed player assets", async () => {
  const res = await fetch(at("/assets/app.js"));
  expect(res.status).toBe(200);
  expect(res.headers.get("content-type")).toContain("javascript");
});

test("serves the bundle (manifest.json + mp4) under /bundle/", async () => {
  const m = await fetch(at("/bundle/manifest.json"));
  expect(m.status).toBe(200);
  expect(m.headers.get("content-type")).toContain("application/json");

  const v = await fetch(at("/bundle/video-16x9.mp4"));
  expect(v.status).toBe(200);
  expect(v.headers.get("content-type")).toBe("video/mp4");
  expect(await v.text()).toContain("not-a-real-mp4");
});

test("status endpoint returns success", async () => {
  const json = (await (await fetch(at("/status"))).json()) as { videoId: string; status: string };
  expect(json.status).toBe("success");
  expect(json.videoId).toBe("abc123def456");
});

test("a missing bundle file 404s", async () => {
  expect((await fetch(at("/bundle/nope.mp4"))).status).toBe(404);
});

test("unknown routes fall back to the SPA shell", async () => {
  const res = await fetch(at("/watch/anything"));
  expect(res.status).toBe(200);
  expect(await res.text()).toContain("id=root");
});
