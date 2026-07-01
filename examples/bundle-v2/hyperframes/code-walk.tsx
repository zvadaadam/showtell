/* eslint-disable react/react-in-jsx-scope */
/* @jsx h */
import {
  type HyperframeContext,
  type HyperframeModule,
  type JsonSchema,
  Stage,
  Stack,
  Text,
  CodeRef,
  Chart,
  Callout,
  CaptionSafeArea,
  KineticCaption,
  defineHyperframe,
  h,
} from "@agent-video/hyperframes";

interface Props {
  title: string;
}

const propsSchema: JsonSchema = {
  type: "object",
  additionalProperties: false,
  required: ["title"],
  properties: {
    title: { type: "string" },
  },
};

const inputs = {
  source: { kind: "repo", refKind: "code" },
  metrics: { kind: "asset", assetType: "data" },
  reveal: { kind: "range" },
} as const;

function render(ctx: HyperframeContext<Props>) {
  const reveal = ctx.range("reveal");
  const source = ctx.repo("source");
  const metricsInput = ctx.asset("metrics");
  const metrics = metricsInput.type === "data" && Array.isArray(metricsInput.data) ? metricsInput.data : [];
  const isPortrait = ctx.viewport.aspectRatio === "9:16";

  if (source.kind !== "code") {
    return (
      <Stage tone="paper" padding="xl">
        <Text variant="title">Expected a code ref</Text>
      </Stage>
    );
  }

  return (
    <Stage tone="paper" padding="xl">
      <CaptionSafeArea>
        <Stack direction={isPortrait ? "vertical" : "horizontal"} gap="lg">
          <Stack grow>
            <Text variant="eyebrow">agent-video bundle v2</Text>
            <Text variant="title">{ctx.props.title}</Text>
            <Text variant="body">
              Hyperframes make the visual decisions, but every input is declared in spec.json and resolved by the
              renderer.
            </Text>
            <Chart
              data={metrics}
              type="bar"
              x="package"
              y="weight"
              title="Where the work lives"
              reveal={ctx.scene.progress}
            />
          </Stack>
          <Stack grow>
            <CodeRef source={source} focus={source.focus} reveal={reveal.progress} maxLines={26} />
            {reveal.active ? <Callout text="renderer-owned timing" /> : null}
          </Stack>
        </Stack>
      </CaptionSafeArea>
      <KineticCaption source="narration" mode="word-pop" emphasis={["Hyperframes", "renderer"]} position="bottom" />
    </Stage>
  );
}

export default defineHyperframe({ schemaVersion: 1, propsSchema, inputs, render } satisfies HyperframeModule<Props>);
