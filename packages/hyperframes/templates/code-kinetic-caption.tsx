/* eslint-disable react/react-in-jsx-scope */
/* @jsx h */
import {
  type HyperframeContext,
  type JsonSchema,
  CodeRef,
  CaptionSafeArea,
  Callout,
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
  emphasis?: string[];
  captionStyle?: "word-pop" | "karaoke" | "stacked" | "minimal";
}

const propsSchema: JsonSchema = {
  type: "object",
  additionalProperties: false,
  required: ["title"],
  properties: {
    eyebrow: { type: "string" },
    title: { type: "string" },
    callout: { type: "string" },
    emphasis: { type: "array", items: { type: "string" } },
    captionStyle: { enum: ["word-pop", "karaoke", "stacked", "minimal"] },
  },
};

const inputs = {
  source: { kind: "repo", refKind: "code" },
  reveal: { kind: "range", optional: true },
} as const;

function render(ctx: HyperframeContext<Props>) {
  const source = ctx.repo("source");
  const reveal = ctx.range("reveal");

  if (source.kind !== "code") {
    return (
      <Stage padding="xl">
        <LowerThird title="Expected a code input" subtitle="Map visual.inputs.source to a code ref." />
      </Stage>
    );
  }

  return (
    <Stage padding="lg">
      <CaptionSafeArea>
        <Stack direction="vertical" gap="md" grow>
          <LowerThird eyebrow={ctx.props.eyebrow} title={ctx.props.title} />
          <CodeRef source={source} focus={source.focus} reveal={reveal.progress} maxLines={24} />
          {ctx.props.callout ? <Callout text={ctx.props.callout} tone="info" /> : null}
        </Stack>
      </CaptionSafeArea>
      <KineticCaption
        source="narration"
        mode={ctx.props.captionStyle ?? "word-pop"}
        emphasis={ctx.props.emphasis}
        position="bottom"
        maxWords={8}
      />
    </Stage>
  );
}

export default defineHyperframe({ schemaVersion: 1, propsSchema, inputs, render });
