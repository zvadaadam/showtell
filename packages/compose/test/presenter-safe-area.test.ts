import { expect, test } from "bun:test";
import { presenterSafeArea } from "../src/presenter.ts";

test("presenter safe areas follow the resolved landscape and portrait positions", () => {
  expect(presenterSafeArea("auto", "md", { width: 1920, height: 1080 })).toMatchObject({
    position: "top-right",
    left: 0,
    bottom: 0,
  });
  const landscape = presenterSafeArea("auto", "md", { width: 1920, height: 1080 });
  expect(landscape.top).toBeGreaterThan(0);
  expect(landscape.right).toBeGreaterThan(0);

  expect(presenterSafeArea("auto", "md", { width: 1080, height: 1920 })).toMatchObject({
    position: "top-center",
    right: 0,
    bottom: 0,
    left: 0,
  });
  expect(presenterSafeArea("auto", "md", { width: 1080, height: 1920 }).top).toBeGreaterThan(0);
});
