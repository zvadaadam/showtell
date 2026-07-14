import { test, expect } from "bun:test";
import { GlobalFonts } from "@napi-rs/canvas";
import { REGISTERED_FONT_FAMILIES } from "@showtell/core";
import { ensureFonts } from "../src/fonts.ts";

test("every theme-allowlisted font family is registered for canvas chrome", () => {
  ensureFonts();
  for (const family of REGISTERED_FONT_FAMILIES) {
    expect(GlobalFonts.has(family), `font family "${family}" must be registered`).toBe(true);
  }
});
