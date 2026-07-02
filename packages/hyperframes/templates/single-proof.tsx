/* eslint-disable react/react-in-jsx-scope */
/* @jsx h */
import {
  type HyperframeContext,
  type JsonSchema,
  CaptionSafeArea,
  Callout,
  Chart,
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
  takeaway?: string;
  chartTitle?: string;
  x: string;
  y: string;
  chartType?: "bar" | "line" | "pie";
  emphasis?: string[];
  focus?: "chart";
}

const propsSchema: JsonSchema = {
  type: "object",
  additionalProperties: false,
  required: ["title", "x", "y"],
  properties: {
    eyebrow: { type: "string" },
    title: { type: "string" },
    takeaway: { type: "string" },
    chartTitle: { type: "string" },
    x: { type: "string" },
    y: { type: "string" },
    chartType: { enum: ["bar", "line", "pie"] },
    emphasis: { type: "array", items: { type: "string" } },
    focus: { enum: ["chart"] },
  },
};

const inputs = {
  metrics: { kind: "asset", assetType: "data" },
} as const;

function render(ctx: HyperframeContext<Props>) {
  const metrics = ctx.asset("metrics");
  const chartData = metrics.type === "data" ? metrics.data : [];

  return (
    <Stage padding="xl">
      <CaptionSafeArea>
        <Stack direction="vertical" gap="lg" grow>
          <Stack direction="vertical" gap="sm">
            <Text variant="eyebrow">{ctx.props.eyebrow ?? "proof"}</Text>
            <Text variant="title">{ctx.props.title}</Text>
          </Stack>
          <Chart
            data={chartData}
            type={ctx.props.chartType ?? "bar"}
            x={ctx.props.x}
            y={ctx.props.y}
            title={ctx.props.chartTitle ?? "Evidence"}
            reveal={ctx.scene.progress}
          />
          {ctx.props.takeaway ? <Callout text={ctx.props.takeaway} tone="success" /> : null}
        </Stack>
      </CaptionSafeArea>
      <KineticCaption source="narration" mode="minimal" emphasis={ctx.props.emphasis} position="bottom" />
    </Stage>
  );
}

export default defineHyperframe({ schemaVersion: 1, propsSchema, inputs, render });
