import { expect, test } from "bun:test";
import { assertBrowserArchiveEntries } from "./browser-bundle.ts";

test("browser archive entries stay inside the browser subtree", () => {
  expect(() =>
    assertBrowserArchiveEntries([
      "browser/",
      "browser/runtime.json",
      "browser/chromium_headless_shell-1228/chrome-headless-shell",
    ]),
  ).not.toThrow();
});

test("browser archive entries reject traversal and unrelated roots", () => {
  expect(() => assertBrowserArchiveEntries(["browser/../../showtell"])).toThrow("Unsafe browser archive entry");
  expect(() => assertBrowserArchiveEntries(["showtell"])).toThrow("Unsafe browser archive entry");
  expect(() => assertBrowserArchiveEntries(["/browser/runtime.json"])).toThrow("Unsafe browser archive entry");
});
