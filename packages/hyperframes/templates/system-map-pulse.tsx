/* eslint-disable react/react-in-jsx-scope */
/* @jsx h */
import {
  type HyperframeContext,
  type JsonSchema,
  CaptionSafeArea,
  PhaseBanner,
  Stack,
  Stage,
  StatusRail,
  SystemMap,
  h,
  defineHyperframe,
} from "@agent-video/hyperframes";

interface Props {
  eyebrow?: string;
  title: string;
  subtitle?: string;
  steps: string[];
  showRail?: boolean;
}

const propsSchema: JsonSchema = {
  type: "object",
  additionalProperties: false,
  required: ["title", "steps"],
  properties: {
    eyebrow: { type: "string" },
    title: { type: "string" },
    subtitle: { type: "string" },
    steps: { type: "array", minItems: 2, items: { type: "string" } },
    showRail: { type: "boolean" },
  },
};

const inputs = {};

function render(ctx: HyperframeContext<Props>) {
  const activeIndex = Math.min(ctx.props.steps.length - 1, Math.floor(ctx.scene.progress * ctx.props.steps.length));

  return (
    <Stage padding="xl">
      <CaptionSafeArea>
        <Stack direction="vertical" gap="lg" grow>
          <PhaseBanner
            eyebrow={ctx.props.eyebrow}
            title={ctx.props.title}
            subtitle={ctx.props.subtitle}
            phase={activeIndex}
          />
          <SystemMap steps={ctx.props.steps} activeIndex={activeIndex} orientation="auto" />
          {ctx.props.showRail ? (
            <StatusRail steps={ctx.props.steps} activeIndex={activeIndex} progress={ctx.scene.progress} />
          ) : null}
        </Stack>
      </CaptionSafeArea>
    </Stage>
  );
}

export default defineHyperframe({ schemaVersion: 1, propsSchema, inputs, render });
