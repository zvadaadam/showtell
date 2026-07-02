import type { BundleScene } from "./bundle.ts";

const ID = "[A-Za-z][A-Za-z0-9_-]{0,63}";
const SCOPED = `(?:(?<scene>${ID})\\/)?(?<id>${ID})`;

export type BundleTimePointRef =
  | { kind: "video"; pos: "start" | "end" }
  | { kind: "scene"; sceneId: string; pos: "start" | "end" }
  | { kind: "line"; sceneId?: string; id: string; pos: "start" | "end" }
  | { kind: "beat"; sceneId?: string; id: string; pos: "start" | "end" | number }
  | { kind: "range"; sceneId?: string; id: string; pos: "start" | "end" }
  | { kind: "anchor"; sceneId: string; id: string };

export type BundleTimeSpanRef =
  | { kind: "video" }
  | { kind: "scene"; sceneId: string }
  | { kind: "line"; sceneId?: string; id: string }
  | { kind: "beat"; sceneId?: string; id: string }
  | { kind: "range"; sceneId?: string; id: string };

export type BundleTimeSpanValue = BundleScene["ranges"][string] | string;

export function parseBundleTimePointRef(ref: string): BundleTimePointRef | undefined {
  if (ref === "video@start") return { kind: "video", pos: "start" };
  if (ref === "video@end") return { kind: "video", pos: "end" };

  const scene = ref.match(new RegExp(`^scene:(${ID})@(start|end)$`));
  if (scene) return { kind: "scene", sceneId: scene[1]!, pos: scene[2] as "start" | "end" };

  const beat = ref.match(new RegExp(`^beat:${SCOPED}@(?<pos>start|end|0(?:\\.\\d+)?|1(?:\\.0+)?)$`));
  if (beat?.groups?.id) {
    const pos = beat.groups.pos!;
    return {
      kind: "beat",
      sceneId: beat.groups.scene,
      id: beat.groups.id,
      pos: pos === "start" || pos === "end" ? pos : Number(pos),
    };
  }

  const line = ref.match(new RegExp(`^line:${SCOPED}@(?<pos>start|end)$`));
  if (line?.groups?.id) {
    return {
      kind: "line",
      sceneId: line.groups.scene,
      id: line.groups.id,
      pos: line.groups.pos as "start" | "end",
    };
  }

  const range = ref.match(new RegExp(`^range:${SCOPED}@(?<pos>start|end)$`));
  if (range?.groups?.id) {
    return {
      kind: "range",
      sceneId: range.groups.scene,
      id: range.groups.id,
      pos: range.groups.pos as "start" | "end",
    };
  }

  const anchor = ref.match(new RegExp(`^anchor:(${ID})\\/(${ID})$`));
  if (anchor) return { kind: "anchor", sceneId: anchor[1]!, id: anchor[2]! };

  return undefined;
}

export function parseBundleTimeSpanRef(ref: string): BundleTimeSpanRef | undefined {
  if (ref === "video") return { kind: "video" };

  const scene = ref.match(new RegExp(`^scene:(${ID})$`));
  if (scene) return { kind: "scene", sceneId: scene[1]! };

  const beat = ref.match(new RegExp(`^beat:${SCOPED}$`));
  if (beat?.groups?.id) return { kind: "beat", sceneId: beat.groups.scene, id: beat.groups.id };

  const line = ref.match(new RegExp(`^line:${SCOPED}$`));
  if (line?.groups?.id) return { kind: "line", sceneId: line.groups.scene, id: line.groups.id };

  const range = ref.match(new RegExp(`^range:${SCOPED}$`));
  if (range?.groups?.id) return { kind: "range", sceneId: range.groups.scene, id: range.groups.id };

  return undefined;
}
