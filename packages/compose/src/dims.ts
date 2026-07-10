import type { AspectRatio } from "@showtell/core";

export interface Dims {
  width: number;
  height: number;
}

/** Output pixel dimensions per aspect ratio (1080p-class). */
export function dimsFor(ar: AspectRatio): Dims {
  switch (ar) {
    case "16:9":
      return { width: 1920, height: 1080 };
    case "9:16":
      return { width: 1080, height: 1920 };
    case "1:1":
      return { width: 1080, height: 1080 };
  }
}
