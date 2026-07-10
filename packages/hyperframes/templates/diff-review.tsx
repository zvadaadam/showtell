/* eslint-disable react/react-in-jsx-scope */
/* @jsx h */
import {
  type HyperframeContext,
  type JsonSchema,
  CaptionSafeArea,
  Callout,
  DiffRef,
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
  callout?: string;
  captionMode?: "word-pop" | "karaoke" | "stacked" | "minimal";
}

const propsSchema: JsonSchema = {
  type: "object",
  additionalProperties: false,
  required: ["title"],
  properties: {
    eyebrow: { type: "string" },
    title: { type: "string" },
    callout: { type: "string" },
    captionMode: { enum: ["word-pop", "karaoke", "stacked", "minimal"] },
  },
};

const inputs = {
  source: { kind: "repo", refKind: "diff" },
} as const;

function render(ctx: HyperframeContext<Props>) {
  const source = ctx.repo("source");

  if (source.kind !== "diff") {
    return (
      <Stage padding="xl">
        <LowerThird title="Expected a diff input" subtitle="Map visual.inputs.source to a diff ref." />
      </Stage>
    );
  }

  return (
    <Stage padding="lg">
      <CaptionSafeArea>
        <Stack direction="vertical" gap="md" grow>
          <LowerThird eyebrow={ctx.props.eyebrow ?? "change review"} title={ctx.props.title} />
          <DiffRef source={source} focus="changed" reveal={ctx.scene.progress} />
          {ctx.props.callout ? <Callout text={ctx.props.callout} tone="info" /> : null}
        </Stack>
      </CaptionSafeArea>
      <KineticCaption source="narration" mode={ctx.props.captionMode ?? "minimal"} position="bottom" />
    </Stage>
  );
}

export default defineHyperframe({ schemaVersion: 1, propsSchema, inputs, render });
