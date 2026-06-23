import { test, expect, afterAll } from "bun:test";
import { writeFileSync, rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { startPreviewServer } from "../src/preview.ts";

const mp4 = join(tmpdir(), "agent-video-preview-fixture-16x9.mp4");
writeFileSync(mp4, Buffer.from("not-a-real-mp4-but-bytes")); // server just streams the file

const handle = startPreviewServer({
  outputs: [{ aspectRatio: "16:9", path: mp4 }],
  title: "Preview Test",
  videoId: "abc123def456",
});

afterAll(() => {
  handle.stop();
  rmSync(mp4, { force: true });
});

test("watch page loads (root and /v/<id>) with the title and a video element", async () => {
  for (const url of [handle.url, handle.watchUrl]) {
    const res = await fetch(url);
    expect(res.status).toBe(200);
    expect(res.headers.get("content-type")).toContain("text/html");
    const body = await res.text();
    expect(body).toContain("Preview Test");
    expect(body).toContain("<video");
    expect(body).toContain("abc123def456");
  }
});

test("status endpoint returns success (mirrors Mainframe shape)", async () => {
  const res = await fetch(`http://localhost:${handle.port}/status`);
  const json = (await res.json()) as { videoId: string; status: string };
  expect(json.status).toBe("success");
  expect(json.videoId).toBe("abc123def456");
});

test("video bytes are served with video/mp4", async () => {
  const res = await fetch(`http://localhost:${handle.port}/video/agent-video-preview-fixture-16x9.mp4`);
  expect(res.status).toBe(200);
  expect(res.headers.get("content-type")).toBe("video/mp4");
  expect((await res.text())).toContain("not-a-real-mp4");
});

test("unknown paths 404", async () => {
  const res = await fetch(`http://localhost:${handle.port}/video/nope.mp4`);
  expect(res.status).toBe(404);
});
