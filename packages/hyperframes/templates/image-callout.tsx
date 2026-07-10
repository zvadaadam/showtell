/* eslint-disable react/react-in-jsx-scope */
/* @jsx h */
import {
  type HyperframeContext,
  type JsonSchema,
  CaptionSafeArea,
  Callout,
  ImageAsset,
  KineticCaption,
  LowerThird,
  Stack,
  Stage,
  h,
  defineHyperframe,
} from "@showtell/hyperframes";

interface Props {
  eyebrow?: string;
  title: string;
  subtitle?: string;
  callout?: string;
  fit?: "contain" | "cover";
  captionMode?: "word-pop" | "karaoke" | "stacked" | "minimal";
}

const propsSchema: JsonSchema = {
  type: "object",
  additionalProperties: false,
  required: ["title"],
  properties: {
    eyebrow: { type: "string" },
    title: { type: "string" },
    subtitle: { type: "string" },
    callout: { type: "string" },
    fit: { enum: ["contain", "cover"] },
    captionMode: { enum: ["word-pop", "karaoke", "stacked", "minimal"] },
  },
};

const inputs = {
  image: { kind: "asset", assetType: "image" },
} as const;

function render(ctx: HyperframeContext<Props>) {
  const image = ctx.asset("image");

  if (image.type !== "image") {
    return (
      <Stage padding="xl">
        <LowerThird title="Expected an image input" subtitle="Map visual.inputs.image to an image asset." />
      </Stage>
    );
  }

  return (
    <Stage padding="lg">
      <CaptionSafeArea>
        <Stack direction="vertical" gap="md" grow>
          <LowerThird eyebrow={ctx.props.eyebrow ?? "demo"} title={ctx.props.title} subtitle={ctx.props.subtitle} />
          <ImageAsset asset={image} fit={ctx.props.fit ?? "contain"} />
          {ctx.props.callout ? <Callout text={ctx.props.callout} tone="info" /> : null}
        </Stack>
      </CaptionSafeArea>
      <KineticCaption source="narration" mode={ctx.props.captionMode ?? "minimal"} position="bottom" />
    </Stage>
  );
}

export default defineHyperframe({ schemaVersion: 1, propsSchema, inputs, render });
