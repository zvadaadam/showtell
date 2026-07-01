/* eslint-disable react/react-in-jsx-scope */
/* @jsx h */
import {
  type HyperframeContext,
  type JsonSchema,
  CaptionSafeArea,
  Callout,
  Chart,
  CodeRef,
  KineticCaption,
  Stack,
  Stage,
  Text,
  h,
  defineHyperframe,
} from "@agent-video/hyperframes";

interface Props {
  eyebrow?: string;
  title: string;
  body?: string;
  chartTitle?: string;
  x: string;
  y: string;
  callouts?: string[];
  emphasis?: string[];
  focus?: "chart" | "code" | "alternating";
}

const propsSchema: JsonSchema = {
  type: "object",
  additionalProperties: false,
  required: ["title", "x", "y"],
  properties: {
    eyebrow: { type: "string" },
    title: { type: "string" },
    body: { type: "string" },
    chartTitle: { type: "string" },
    x: { type: "string" },
    y: { type: "string" },
    callouts: { type: "array", items: { type: "string" } },
    emphasis: { type: "array", items: { type: "string" } },
    focus: { enum: ["chart", "code", "alternating"] },
  },
};

const inputs = {
  source: { kind: "repo", refKind: "code" },
  metrics: { kind: "asset", assetType: "data" },
  reveal: { kind: "range", optional: true },
} as const;

function render(ctx: HyperframeContext<Props>) {
  const source = ctx.repo("source");
  const metrics = ctx.asset("metrics");
  const reveal = ctx.range("reveal");
  const chartData = metrics.type === "data" ? metrics.data : [];
  const activeCallout = ctx.props.callouts?.[Math.floor(ctx.scene.progress * (ctx.props.callouts.length - 1))];
  const focus = ctx.props.focus ?? "alternating";
  const showCode = focus === "code" || (focus === "alternating" && ctx.scene.progress >= 0.5);

  if (source.kind !== "code") {
    return (
      <Stage padding="xl">
        <Text variant="title">Expected a code input</Text>
      </Stage>
    );
  }

  return (
    <Stage padding="xl">
      <CaptionSafeArea>
        <Stack direction="vertical" gap="lg" grow>
          <Stack direction="vertical" gap="md" grow>
            <Text variant="eyebrow">{ctx.props.eyebrow ?? "proof"}</Text>
            <Text variant="title">{ctx.props.title}</Text>
            {ctx.props.body ? <Text variant="body">{ctx.props.body}</Text> : null}
            {showCode ? (
              <CodeRef source={source} focus={source.focus} reveal={reveal.progress} maxLines={26} />
            ) : (
              <Chart
                data={chartData}
                type="bar"
                x={ctx.props.x}
                y={ctx.props.y}
                title={ctx.props.chartTitle ?? "Evidence"}
                reveal={ctx.scene.progress}
              />
            )}
            {activeCallout ? <Callout text={activeCallout} tone="success" /> : null}
          </Stack>
        </Stack>
      </CaptionSafeArea>
      <KineticCaption source="narration" mode="minimal" emphasis={ctx.props.emphasis} position="bottom" />
    </Stage>
  );
}

export default defineHyperframe({ schemaVersion: 1, propsSchema, inputs, render });
