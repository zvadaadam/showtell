import { loadImage } from "@napi-rs/canvas";

export interface ImageInfo {
  width: number;
  height: number;
}

export async function probeImageInfo(path: string): Promise<ImageInfo> {
  const image = await loadImage(path);
  return { width: image.width, height: image.height };
}
