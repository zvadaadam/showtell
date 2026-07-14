import { z } from "zod";
import { ID_PATTERN } from "./id.ts";

export const VisualInputId = z
  .string()
  .regex(new RegExp(`^${ID_PATTERN}$`), "Use 1-64 chars: letters, digits, underscore, hyphen; start with a letter.");

export const VisualInputDescriptor = z.discriminatedUnion("kind", [
  z
    .object({
      kind: z.literal("repo"),
      refKind: z.enum(["code", "diff"]).optional(),
      optional: z.boolean().default(false),
    })
    .strict(),
  z
    .object({
      kind: z.literal("asset"),
      assetType: z.enum(["audio", "data", "image"]).optional(),
      optional: z.boolean().default(false),
    })
    .strict(),
  z.object({ kind: z.literal("range"), optional: z.boolean().default(false) }).strict(),
]);

export type VisualInputDescriptor = z.infer<typeof VisualInputDescriptor>;
