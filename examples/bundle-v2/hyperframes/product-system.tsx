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
} from "@showtell/hyperframes";

interface Props {
  eyebrow?: string;
  title: string;
  body?: string;
  steps?: string[];
  callouts?: string[];
  chartTitle?: string;
}

const propsSchema: JsonSchema = {
  type: "object",
  additionalProperties: false,
  required: ["title"],
  properties: {
    eyebrow: { type: "string" },
    title: { type: "string" },
    body: { type: "string" },
    steps: { type: "array", items: { type: "string" } },
    callouts: { type: "array", items: { type: "string" } },
    chartTitle: { type: "string" },
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
  const callout = ctx.props.callouts?.[Math.min(ctx.props.callouts.length - 1, Math.floor(ctx.scene.progress * 2))];
  const isPortrait = ctx.viewport.aspectRatio === "9:16";
  const openingFocal = callout && ctx.scene.index % 2 === 1 ? "callout" : "chart";
  const focal = ctx.scene.lineIndex === ctx.scene.lineCount - 1 ? "code" : openingFocal;
  const revealProgress = Math.max(0.35, ctx.scene.progress, reveal.progress);

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
            <Text variant="eyebrow">{ctx.props.eyebrow ?? "showtell bundle v2"}</Text>
            <Text variant="title">{ctx.props.title}</Text>
            {ctx.props.body ? <Text variant="body">{ctx.props.body}</Text> : null}
          </Stack>
          <Stack grow>
            {focal === "chart" ? (
              <Chart
                data={metrics}
                type="bar"
                x="stage"
                y="weight"
                title={ctx.props.chartTitle ?? "Pipeline leverage"}
                reveal={revealProgress}
              />
            ) : null}
            {focal === "code" ? (
              <CodeRef source={source} focus={source.focus} reveal={revealProgress} maxLines={26} />
            ) : null}
            {focal === "callout" && callout ? <Callout text={callout} /> : null}
          </Stack>
        </Stack>
      </CaptionSafeArea>
      <KineticCaption source="narration" mode="minimal" emphasis={["agent", "renderer"]} position="bottom" />
    </Stage>
  );
}

export default defineHyperframe({ schemaVersion: 1, propsSchema, inputs, render } satisfies HyperframeModule<Props>);
