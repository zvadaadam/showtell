export type JsonSchema =
  | boolean
  | {
      type?: "object" | "array" | "string" | "number" | "integer" | "boolean";
      enum?: unknown[];
      additionalProperties?: boolean;
      required?: string[];
      properties?: Record<string, JsonSchema>;
      items?: JsonSchema;
      minLength?: number;
      maxLength?: number;
      minimum?: number;
      maximum?: number;
      minItems?: number;
      maxItems?: number;
    };

export type HyperframeInput =
  | { kind: "repo"; refKind?: "code" | "diff"; optional?: boolean }
  | { kind: "asset"; assetType?: "audio" | "data" | "image"; optional?: boolean }
  | { kind: "range"; optional?: boolean };

export type HyperframeInputs = Record<string, HyperframeInput>;

export interface HyperframeModule<Props = Record<string, unknown>> {
  schemaVersion: 1;
  propsSchema: JsonSchema;
  inputs?: HyperframeInputs;
  render(ctx: HyperframeContext<Props>): HyperframeElement;
}

export function defineHyperframe<Props>(module: HyperframeModule<Props>): HyperframeModule<Props> {
  return module;
}

export interface HyperframeElement<Type extends string = string, Props extends object = object> {
  type: Type;
  props: Props;
  children: HyperframeChild[];
}

export type HyperframeChild = HyperframeElement | string | number | boolean | null | undefined | HyperframeChild[];

export type HyperframeComponent<Props extends object = Record<string, unknown>> = (
  props: Props & { children?: HyperframeChild },
) => HyperframeElement;

export function h<Props extends object>(
  type: HyperframeComponent<Props>,
  props: Props | null,
  ...children: HyperframeChild[]
): HyperframeElement;
export function h<Type extends string, Props extends object>(
  type: Type,
  props: Props | null,
  ...children: HyperframeChild[]
): HyperframeElement<Type, Props>;
export function h(
  type: string | HyperframeComponent,
  props: Record<string, unknown> | null,
  ...children: HyperframeChild[]
): HyperframeElement {
  if (typeof type === "function") return type(Object.assign({}, props, { children }));
  return { type, props: props ?? {}, children };
}

export interface HyperframeContext<Props> {
  props: Props;
  viewport: {
    width: number;
    height: number;
    aspectRatio: "16:9" | "9:16" | "1:1";
    fps: number;
  };
  scene: {
    id: string;
    index: number;
    startMs: number;
    durationMs: number;
    progress: number;
    lineIndex: number;
    lineCount: number;
    lineId?: string;
  };
  time: {
    absoluteMs: number;
    sceneMs: number;
    frame: number;
  };
  range(idOrRef: string): ResolvedRange;
  repo(refId: string): ResolvedCode | ResolvedDiff;
  asset(assetId: string): ResolvedAsset;
  captions: {
    safeArea: { top: number; right: number; bottom: number; left: number };
    activeCue?: CaptionCue;
    words?: CaptionWord[];
    timing: "estimated" | "aligned";
  };
  theme: HyperframeTheme;
  random(key: string): number;
}

export interface ResolvedRange {
  active: boolean;
  progress: number;
  startMs: number;
  endMs: number;
  durationMs: number;
}

export interface ResolvedCode {
  kind: "code";
  id: string;
  file: string;
  ref?: string;
  lineStart?: number;
  lineEnd?: number;
  focus?: number[];
  language?: string;
  text: string;
  sha256: string;
}

export interface ResolvedDiff {
  kind: "diff";
  id: string;
  file: string;
  ref: string;
  text: string;
  added: number;
  removed: number;
  sha256: string;
}

export type ResolvedAsset =
  | { type: "data"; id: string; src: string; sha256: string; data: unknown }
  | { type: "audio"; id: string; src: string; sha256: string; durationMs: number; path: string }
  | { type: "image"; id: string; src: string; sha256: string; width: number; height: number; path: string };

export interface CaptionCue {
  sceneId: string;
  lineId: string;
  text: string;
  startMs: number;
  endMs: number;
}

export interface CaptionWord {
  text: string;
  startMs: number;
  endMs: number;
  confidence?: number;
}

export type ThemePreset = "agent-dark" | "paper" | "neutral";

export interface HyperframeThemeColors {
  fg: string;
  bg: string;
  subtle: string;
  accent: string;
  success: string;
  warning: string;
  surface: string;
  border: string;
  captionBg: string;
  captionFg: string;
}

export interface HyperframeTypography {
  display: string;
  body: string;
  mono: string;
}

export interface HyperframeTheme {
  preset: ThemePreset;
  mode: Tone;
  colors: HyperframeThemeColors;
  typography: HyperframeTypography;
}

export type Tone = "paper" | "dark" | "neutral";
export type Gap = "xs" | "sm" | "md" | "lg" | "xl";
export type Padding = Gap;

export interface StageProps {
  /** Local treatment hint for fallback rendering. Use spec meta.theme.preset for the video palette. */
  tone?: Tone;
  padding?: Padding;
  children?: HyperframeChild;
}

export interface StackProps {
  direction?: "horizontal" | "vertical";
  gap?: Gap;
  grow?: boolean;
  children?: HyperframeChild;
}

export interface GridProps {
  columns?: number;
  gap?: Gap;
  grow?: boolean;
  children?: HyperframeChild;
}

export interface TextProps {
  variant?: "eyebrow" | "title" | "section" | "body" | "caption";
  children?: HyperframeChild;
}

export interface CodeRefProps {
  source: ResolvedCode;
  focus?: number[];
  reveal?: number;
  maxLines?: number;
}

export interface DiffRefProps {
  source: ResolvedDiff;
  focus?: "file" | "changed" | number[];
  reveal?: number;
}

export interface ChartProps {
  data: unknown;
  type: "bar" | "line" | "pie";
  x: string;
  y: string;
  title?: string;
  reveal?: number;
}

export interface ImageAssetProps {
  asset: Extract<ResolvedAsset, { type: "image" }>;
  fit?: "contain" | "cover";
}

export interface CalloutProps {
  text: string;
  tone?: "info" | "success" | "warning";
  when?: boolean;
}

export interface CaptionSafeAreaProps {
  children?: HyperframeChild;
}

export interface KineticCaptionProps {
  source?: "narration";
  mode?: "word-pop" | "karaoke" | "stacked" | "minimal";
  emphasis?: string[];
  maxWords?: number;
  position?: "bottom" | "middle" | "top";
}

export interface LowerThirdProps {
  eyebrow?: string;
  title: string;
  subtitle?: string;
  tone?: Tone;
}

export interface TimelineRailProps {
  steps: string[];
  activeIndex?: number;
  progress?: number;
}

export interface SystemMapProps {
  steps: string[];
  activeIndex?: number;
  orientation?: "auto" | "horizontal" | "vertical";
}

export interface PanelProps {
  title?: string;
  subtitle?: string;
  tone?: "default" | "accent" | "success" | "warning";
  padding?: Padding;
  grow?: boolean;
  children?: HyperframeChild;
}

export interface BadgeProps {
  text: string;
  tone?: "info" | "success" | "warning" | "muted";
}

export interface DividerProps {
  label?: string;
}

export interface MeterProps {
  label?: string;
  value?: number;
  max?: number;
  progress?: number;
  tone?: "info" | "success" | "warning";
}

export const Stage = component<StageProps>("Stage");
export const Stack = component<StackProps>("Stack");
export const Grid = component<GridProps>("Grid");
export const Text = component<TextProps>("Text");
export const CodeRef = component<CodeRefProps>("CodeRef");
export const DiffRef = component<DiffRefProps>("DiffRef");
export const Chart = component<ChartProps>("Chart");
export const ImageAsset = component<ImageAssetProps>("ImageAsset");
export const Callout = component<CalloutProps>("Callout");
export const CaptionSafeArea = component<CaptionSafeAreaProps>("CaptionSafeArea");
export const KineticCaption = component<KineticCaptionProps>("KineticCaption");
export const LowerThird = component<LowerThirdProps>("LowerThird");
export const TimelineRail = component<TimelineRailProps>("TimelineRail");
export const SystemMap = component<SystemMapProps>("SystemMap");
export const Panel = component<PanelProps>("Panel");
export const Badge = component<BadgeProps>("Badge");
export const Divider = component<DividerProps>("Divider");
export const Meter = component<MeterProps>("Meter");

export interface StoryItem {
  label: string;
  detail?: string;
}

export type StoryItemInput = string | StoryItem;

export interface PhaseBannerProps {
  eyebrow?: string;
  title: string;
  subtitle?: string;
  phase?: number;
}

export interface SignalWallProps {
  items: StoryItemInput[];
  activeIndex?: number;
  columns?: number;
}

export interface LaneStackProps {
  lanes: StoryItemInput[];
  activeIndex?: number;
}

export interface DecisionGridProps {
  options: StoryItemInput[];
  activeIndex?: number;
  columns?: number;
}

export interface ProofLadderProps {
  items: StoryItemInput[];
  activeIndex?: number;
}

export interface StatusRailProps {
  steps: string[];
  activeIndex?: number;
  progress?: number;
}

export interface CaptionDeckProps {
  eyebrow?: string;
  title: string;
  subtitle?: string;
  captionMode?: KineticCaptionProps["mode"];
}

function storyItem(item: StoryItemInput, index: number): StoryItem {
  if (typeof item === "string") return { label: item || `Item ${index + 1}` };
  return { label: item.label || `Item ${index + 1}`, detail: item.detail };
}

function storyItems(items: StoryItemInput[], fallback: string[]): StoryItem[] {
  const source = items.length ? items : fallback;
  return source.map(storyItem);
}

function boundedIndex(index: number | undefined, length: number): number {
  if (length <= 0) return 0;
  return Math.max(0, Math.min(length - 1, Math.floor(index ?? 0)));
}

export const PhaseBanner: HyperframeComponent<PhaseBannerProps> = (props) =>
  h(
    Stack,
    { direction: "vertical", gap: "sm" },
    props.eyebrow ? h(Text, { variant: "eyebrow" }, props.eyebrow) : null,
    h(Text, { variant: "title" }, props.title),
    props.subtitle ? h(Text, { variant: "body" }, props.subtitle) : null,
    typeof props.phase === "number" ? h(Badge, { text: `phase ${props.phase + 1}`, tone: "muted" }) : null,
  );

export const SignalWall: HyperframeComponent<SignalWallProps> = (props) => {
  const items = storyItems(props.items, ["Input", "Transform", "Output", "Proof"]);
  const active = boundedIndex(props.activeIndex, items.length);
  return h(
    Grid,
    { columns: props.columns ?? 2, gap: "sm" },
    items.map((item, index) =>
      h(
        Panel,
        { tone: index === active ? "success" : "default", padding: "sm" },
        h(Badge, { text: index === active ? "active" : "queued", tone: index === active ? "success" : "muted" }),
        h(Text, { variant: "section" }, item.label),
        item.detail ? h(Text, { variant: "caption" }, item.detail) : null,
      ),
    ),
  );
};

export const LaneStack: HyperframeComponent<LaneStackProps> = (props) => {
  const lanes = storyItems(props.lanes, ["Agent", "Hyperframe", "Renderer"]);
  const active = boundedIndex(props.activeIndex, lanes.length);
  return h(
    Stack,
    { direction: "vertical", gap: "sm" },
    lanes.map((lane, index) =>
      h(
        Panel,
        { tone: index <= active ? "accent" : "default", padding: "sm" },
        h(Badge, { text: String(index + 1), tone: index <= active ? "info" : "muted" }),
        h(Text, { variant: "section" }, lane.label),
        lane.detail ? h(Text, { variant: "caption" }, lane.detail) : null,
      ),
    ),
  );
};

export const DecisionGrid: HyperframeComponent<DecisionGridProps> = (props) => {
  const options = storyItems(props.options, ["Option A", "Option B", "Option C"]);
  const active = boundedIndex(props.activeIndex, options.length);
  return h(
    Grid,
    { columns: props.columns ?? Math.min(3, options.length), gap: "md" },
    options.map((option, index) =>
      h(
        Panel,
        { tone: index === active ? "accent" : "default", padding: "md" },
        h(Badge, {
          text: index === active ? "selected" : `option ${index + 1}`,
          tone: index === active ? "info" : "muted",
        }),
        h(Text, { variant: "section" }, option.label),
        option.detail ? h(Text, { variant: "caption" }, option.detail) : null,
      ),
    ),
  );
};

export const ProofLadder: HyperframeComponent<ProofLadderProps> = (props) => {
  const items = storyItems(props.items, ["Claim", "Evidence", "Mechanism", "Outcome"]);
  const active = boundedIndex(props.activeIndex, items.length);
  return h(
    Stack,
    { direction: "vertical", gap: "sm" },
    items.map((item, index) =>
      h(
        Stack,
        { direction: "vertical", gap: "xs" },
        h(Meter, {
          label: item.label,
          progress: (index + 1) / items.length,
          tone: index <= active ? "success" : "info",
        }),
        item.detail ? h(Text, { variant: "caption" }, item.detail) : null,
      ),
    ),
  );
};

export const StatusRail: HyperframeComponent<StatusRailProps> = (props) =>
  h(
    Stack,
    { direction: "vertical", gap: "sm" },
    h(TimelineRail, { steps: props.steps, activeIndex: props.activeIndex }),
    h(Meter, {
      progress:
        props.progress ??
        (props.steps.length ? (boundedIndex(props.activeIndex, props.steps.length) + 1) / props.steps.length : 0),
    }),
  );

export const CaptionDeck: HyperframeComponent<CaptionDeckProps> = (props) =>
  h(
    Stack,
    { direction: "vertical", gap: "md" },
    h(LowerThird, { eyebrow: props.eyebrow, title: props.title, subtitle: props.subtitle }),
    h(KineticCaption, { source: "narration", mode: props.captionMode ?? "minimal", position: "bottom" }),
  );

export interface HyperframeComponentManifest {
  id: string;
  title: string;
  importName: string;
  layer: "host" | "story" | "media";
  description: string;
  bestFor: string[];
  requiredProps?: string[];
  commonProps?: string[];
  example: string;
}

export const hyperframeComponents: HyperframeComponentManifest[] = [
  {
    id: "stage",
    title: "Stage",
    importName: "Stage",
    layer: "host",
    description: "Root frame component that sets frame treatment and page padding.",
    bestFor: ["every hyperframe root", "responsive framing", "frame padding"],
    commonProps: ["tone", "padding"],
    example: '<Stage padding="lg">...</Stage>',
  },
  {
    id: "stack",
    title: "Stack",
    importName: "Stack",
    layer: "host",
    description: "Vertical or horizontal layout stack with deterministic gaps.",
    bestFor: ["linear layouts", "headers plus body", "split ownership lanes"],
    commonProps: ["direction", "gap", "grow"],
    example: '<Stack direction="vertical" gap="lg" grow>...</Stack>',
  },
  {
    id: "grid",
    title: "Grid",
    importName: "Grid",
    layer: "host",
    description: "Simple equal-cell grid for comparing repeated visual units.",
    bestFor: ["options", "signals", "multi-panel comparisons"],
    commonProps: ["columns", "gap", "grow"],
    example: '<Grid columns={3} gap="md">...</Grid>',
  },
  {
    id: "text",
    title: "Text",
    importName: "Text",
    layer: "host",
    description: "Renderer-owned typography with safe variants.",
    bestFor: ["headings", "section labels", "short body copy"],
    commonProps: ["variant"],
    example: '<Text variant="title">Component-first videos</Text>',
  },
  {
    id: "panel",
    title: "Panel",
    importName: "Panel",
    layer: "host",
    description: "Framed container for grouped text or nested component content.",
    bestFor: ["cards", "grouped explanations", "small dashboards"],
    commonProps: ["title", "subtitle", "tone", "padding", "grow"],
    example: '<Panel tone="accent" padding="md">...</Panel>',
  },
  {
    id: "badge",
    title: "Badge",
    importName: "Badge",
    layer: "host",
    description: "Compact status pill for labels, phases, and states.",
    bestFor: ["status labels", "step markers", "active states"],
    requiredProps: ["text"],
    commonProps: ["tone"],
    example: '<Badge text="active" tone="success" />',
  },
  {
    id: "divider",
    title: "Divider",
    importName: "Divider",
    layer: "host",
    description: "Thin separator with an optional label.",
    bestFor: ["separating sections", "quiet structure", "chapter breaks"],
    commonProps: ["label"],
    example: '<Divider label="then" />',
  },
  {
    id: "meter",
    title: "Meter",
    importName: "Meter",
    layer: "host",
    description: "Deterministic progress bar with optional label.",
    bestFor: ["progress", "confidence", "relative emphasis"],
    commonProps: ["label", "progress", "value", "max", "tone"],
    example: '<Meter label="compile" progress={ctx.scene.progress} tone="info" />',
  },
  {
    id: "callout",
    title: "Callout",
    importName: "Callout",
    layer: "host",
    description: "One-line emphasized note drawn by the renderer.",
    bestFor: ["takeaways", "warnings", "success states"],
    requiredProps: ["text"],
    commonProps: ["tone", "when"],
    example: '<Callout text="Renderer owns timing" tone="success" />',
  },
  {
    id: "caption-safe-area",
    title: "Caption Safe Area",
    importName: "CaptionSafeArea",
    layer: "host",
    description: "Reserves bottom space so visual content does not fight captions.",
    bestFor: ["burn-in captions", "visual captions", "social-safe framing"],
    example: "<CaptionSafeArea>...</CaptionSafeArea>",
  },
  {
    id: "kinetic-caption",
    title: "Kinetic Caption",
    importName: "KineticCaption",
    layer: "host",
    description:
      "Visual narration caption layer inside a hyperframe. mode is accepted; all modes currently produce the same static treatment (one frame per line); it exists for forward-compat. emphasized words render in the theme accent color.",
    bestFor: ["TikTok-style captions", "word-pop overlays", "visual emphasis"],
    commonProps: ["mode", "emphasis", "maxWords", "position"],
    example: '<KineticCaption source="narration" mode="word-pop" position="bottom" />',
  },
  {
    id: "lower-third",
    title: "Lower Third",
    importName: "LowerThird",
    layer: "host",
    description: "Compact title block for scene openings and explainers.",
    bestFor: ["openers", "chapter labels", "speaker-like framing"],
    requiredProps: ["title"],
    commonProps: ["eyebrow", "subtitle", "tone"],
    example: '<LowerThird eyebrow="model" title="Components first" />',
  },
  {
    id: "timeline-rail",
    title: "Timeline Rail",
    importName: "TimelineRail",
    layer: "host",
    description: "Renderer-drawn step rail with one active step.",
    bestFor: ["process progress", "chapter progress", "line-state orientation"],
    requiredProps: ["steps"],
    commonProps: ["activeIndex", "progress"],
    example: "<TimelineRail steps={steps} activeIndex={ctx.scene.lineIndex} />",
  },
  {
    id: "system-map",
    title: "System Map",
    importName: "SystemMap",
    layer: "host",
    description: "Renderer-drawn process map for simple ordered systems.",
    bestFor: ["architecture overviews", "agent/renderer splits", "pipelines"],
    requiredProps: ["steps"],
    commonProps: ["activeIndex", "orientation"],
    example: "<SystemMap steps={steps} activeIndex={ctx.scene.lineIndex} />",
  },
  {
    id: "phase-banner",
    title: "Phase Banner",
    importName: "PhaseBanner",
    layer: "story",
    description: "Reusable title stack with optional eyebrow, subtitle, and phase badge.",
    bestFor: ["scene headers", "line-state chapters", "product explainers"],
    requiredProps: ["title"],
    commonProps: ["eyebrow", "subtitle", "phase"],
    example: "<PhaseBanner title={ctx.props.title} phase={ctx.scene.lineIndex} />",
  },
  {
    id: "decision-grid",
    title: "Decision Grid",
    importName: "DecisionGrid",
    layer: "story",
    description: "Reusable comparison grid that highlights one active option.",
    bestFor: ["tradeoffs", "selection moments", "product model choices"],
    requiredProps: ["options"],
    commonProps: ["activeIndex", "columns"],
    example: "<DecisionGrid options={options} activeIndex={1} />",
  },
  {
    id: "signal-wall",
    title: "Signal Wall",
    importName: "SignalWall",
    layer: "story",
    description: "Grid of active and queued signals for proof or workflow states.",
    bestFor: ["state changes", "evidence walls", "workflow checkpoints"],
    requiredProps: ["items"],
    commonProps: ["activeIndex", "columns"],
    example: "<SignalWall items={signals} activeIndex={ctx.scene.lineIndex} />",
  },
  {
    id: "lane-stack",
    title: "Lane Stack",
    importName: "LaneStack",
    layer: "story",
    description: "Vertical lanes that make ownership and sequencing scannable.",
    bestFor: ["agent/renderer splits", "pipelines", "responsibility maps"],
    requiredProps: ["lanes"],
    commonProps: ["activeIndex"],
    example: "<LaneStack lanes={lanes} activeIndex={2} />",
  },
  {
    id: "proof-ladder",
    title: "Proof Ladder",
    importName: "ProofLadder",
    layer: "story",
    description: "A claim-to-proof sequence with progress meters.",
    bestFor: ["reasoning chains", "evidence build-up", "recommendations"],
    requiredProps: ["items"],
    commonProps: ["activeIndex"],
    example: "<ProofLadder items={proof} activeIndex={ctx.scene.lineIndex} />",
  },
  {
    id: "status-rail",
    title: "Status Rail",
    importName: "StatusRail",
    layer: "story",
    description: "Timeline rail plus progress meter for line-state pacing.",
    bestFor: ["chapter progress", "line-state videos", "process explainers"],
    requiredProps: ["steps"],
    commonProps: ["activeIndex", "progress"],
    example: "<StatusRail steps={steps} activeIndex={ctx.scene.lineIndex} progress={ctx.scene.progress} />",
  },
  {
    id: "caption-deck",
    title: "Caption Deck",
    importName: "CaptionDeck",
    layer: "story",
    description: "Lower-third setup plus visual narration caption layer.",
    bestFor: ["openers", "social captions", "chapter titles"],
    requiredProps: ["title"],
    commonProps: ["eyebrow", "subtitle", "captionMode"],
    example: '<CaptionDeck title="What changed" captionMode="minimal" />',
  },
  {
    id: "code-ref",
    title: "CodeRef",
    importName: "CodeRef",
    layer: "media",
    description: "Trusted live-code media primitive.",
    bestFor: ["repo walkthroughs", "implementation proof", "line focus"],
    requiredProps: ["source"],
    commonProps: ["focus", "reveal", "maxLines"],
    example: '<CodeRef source={ctx.repo("source")} focus={[18]} />',
  },
  {
    id: "diff-ref",
    title: "DiffRef",
    importName: "DiffRef",
    layer: "media",
    description: "Trusted live-diff media primitive.",
    bestFor: ["PR review", "before-after changes", "patch explanations"],
    requiredProps: ["source"],
    commonProps: ["focus", "reveal"],
    example: '<DiffRef source={ctx.repo("source")} focus="changed" />',
  },
  {
    id: "chart",
    title: "Chart",
    importName: "Chart",
    layer: "media",
    description: "Trusted data chart media primitive.",
    bestFor: ["metric proof", "data moments", "comparisons"],
    requiredProps: ["data", "type", "x", "y"],
    commonProps: ["title", "reveal"],
    example: '<Chart data={ctx.asset("metrics").data} type="bar" x="label" y="value" />',
  },
  {
    id: "image-asset",
    title: "ImageAsset",
    importName: "ImageAsset",
    layer: "media",
    description: "Trusted image asset primitive loaded from declared bundle assets.",
    bestFor: ["screenshots", "product stills", "visual before-after moments"],
    requiredProps: ["asset"],
    commonProps: ["fit"],
    example: '<ImageAsset asset={ctx.asset("shot")} fit="contain" />',
  },
];

export interface HyperframeTemplateManifest {
  id: string;
  title: string;
  description: string;
  path: string;
  bestFor: string[];
  requiredInputs: string[];
  visualCaption?: boolean;
}

export const hyperframeTemplates: HyperframeTemplateManifest[] = [
  {
    id: "code-kinetic-caption",
    title: "Explain Code",
    description: "Focused repo code with TikTok-style visual captions and optional reveal timing.",
    path: "packages/hyperframes/templates/code-kinetic-caption.tsx",
    bestFor: ["code walkthroughs", "PR explainers", "short social clips"],
    requiredInputs: ["source"],
    visualCaption: true,
  },
  {
    id: "proof-chart-code",
    title: "Connect Proof To Code",
    description: "Alternates between system map, chart evidence, and live repo code with line-level focus.",
    path: "packages/hyperframes/templates/proof-chart-code.tsx",
    bestFor: ["product explainers", "technical demos", "evidence-backed narratives"],
    requiredInputs: ["source", "metrics"],
    visualCaption: true,
  },
  {
    id: "system-map-pulse",
    title: "Show The Flow",
    description: "A lightweight animated process map with lower-third labels and caption-safe composition.",
    path: "packages/hyperframes/templates/system-map-pulse.tsx",
    bestFor: ["architecture overviews", "pipeline explanations", "scene openers"],
    requiredInputs: [],
    visualCaption: false,
  },
  {
    id: "diff-review",
    title: "Review A Change",
    description: "One focused diff, one lower-third, and one optional reviewer callout.",
    path: "packages/hyperframes/templates/diff-review.tsx",
    bestFor: ["PR walkthroughs", "change reviews", "before-after code explanations"],
    requiredInputs: ["source"],
    visualCaption: true,
  },
  {
    id: "single-proof",
    title: "Prove One Thing",
    description: "A single chart or metric proof with one takeaway and caption-safe space.",
    path: "packages/hyperframes/templates/single-proof.tsx",
    bestFor: ["evidence moments", "metric callouts", "simple data explanations"],
    requiredInputs: ["metrics"],
    visualCaption: true,
  },
  {
    id: "image-callout",
    title: "Show A Result",
    description: "One image or screenshot with a restrained callout and visual caption layer.",
    path: "packages/hyperframes/templates/image-callout.tsx",
    bestFor: ["product demos", "screenshots", "visual before-after moments"],
    requiredInputs: ["image"],
    visualCaption: true,
  },
];

function component<Props extends object>(
  type: string,
): (props: Props & { children?: HyperframeChild }) => HyperframeElement<string, Props> {
  return (props: Props & { children?: HyperframeChild }) => {
    const { children, ...rest } = props;
    return h(type, rest as Props, children);
  };
}

declare global {
  namespace JSX {
    type Element = HyperframeElement;
    interface IntrinsicElements {
      [name: string]: Record<string, unknown>;
    }
  }
}
