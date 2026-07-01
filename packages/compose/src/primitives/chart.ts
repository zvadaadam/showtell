import type { SKRSContext2D } from "@napi-rs/canvas";
import type { ChartScene } from "@agent-video/core";
import { THEME, type CanvasTheme } from "../theme.ts";
import type { Dims } from "../dims.ts";

const SERIES_COLORS = [
  "#7c8cff",
  "#7ee787",
  "#ffb86c",
  "#ff9492",
  "#79c0ff",
  "#d2a8ff",
  "#f2cc60",
  "#56d4bc",
  "#ff7b9c",
  "#9d8cff",
];

interface Parsed {
  labels: string[];
  series: { name: string; values: number[] }[];
}

interface LegendItem {
  label: string;
  colorIndex: number;
}

interface ValueScale {
  min: number;
  max: number;
  yFor(value: number): number;
}

export function parseChartData(
  data: Record<string, string | number>[],
  fields: { x?: string; y?: string } = {},
): Parsed {
  if (fields.x && fields.y) {
    return {
      labels: data.map((d) => String(d[fields.x!] ?? "")),
      series: [
        {
          name: fields.y,
          values: data.map((d) => {
            const value = Number(d[fields.y!]);
            return Number.isFinite(value) ? value : 0;
          }),
        },
      ],
    };
  }
  const keys = Object.keys(data[0] ?? {});
  const labelKey = keys.find((k) => typeof data[0]![k] === "string") ?? keys[0]!;
  const numKeys = keys.filter((k) => k !== labelKey && typeof data[0]![k] === "number");
  const numericKeys = numKeys.length ? numKeys : keys.filter((k) => k !== labelKey);
  return {
    labels: data.map((d) => String(d[labelKey] ?? "")),
    series: numericKeys.map((name) => ({ name, values: data.map((d) => Number(d[name]) || 0) })),
  };
}

export function legendItems(chartType: ChartScene["content"]["chartType"], p: Parsed): LegendItem[] {
  if (chartType === "pie") return p.labels.map((label, i) => ({ label, colorIndex: i }));
  if (chartType === "bar" && p.series.length === 1) return p.labels.map((label, i) => ({ label, colorIndex: i }));
  if (p.series.length > 1) return p.series.map((s, i) => ({ label: s.name, colorIndex: i }));
  return [];
}

export function valueScale(values: number[], plotY: number, chartH: number): ValueScale {
  const minRaw = Math.min(0, ...values);
  const maxRaw = Math.max(0, ...values);
  const span = Math.max(1, maxRaw - minRaw);
  const min = minRaw < 0 ? minRaw - span * 0.12 : 0;
  const max = maxRaw > 0 ? maxRaw + span * 0.12 : 0;
  const domain = Math.max(1, max - min);
  return {
    min,
    max,
    yFor(value: number) {
      return plotY + ((max - value) / domain) * chartH;
    },
  };
}

/** Returns true if the chart had data to plot; false if it drew a "no data" placeholder. */
export function drawChart(ctx: SKRSContext2D, scene: ChartScene, dims: Dims, theme: CanvasTheme = THEME): boolean {
  const base = Math.min(dims.width, dims.height);
  const pad = Math.round(base * 0.1);
  const p = parseChartData(scene.content.data as Record<string, string | number>[], {
    x: scene.content.x,
    y: scene.content.y,
  });

  let top = pad;
  if (scene.content.title) {
    const tSize = Math.round(base * 0.045);
    ctx.font = `${tSize}px '${theme.sansBold}'`;
    ctx.fillStyle = theme.fg;
    ctx.textAlign = "center";
    ctx.textBaseline = "alphabetic";
    ctx.fillText(scene.content.title, dims.width / 2, top + tSize);
    top += tSize * 1.8;
  }

  // A datum can carry no numeric value (only a label) or be all zeros — draw a
  // visible placeholder instead of a blank/broken card, and let the caller warn.
  const hasData = p.series.length > 0 && p.series.some((s) => s.values.some((v) => v !== 0));
  if (!hasData) {
    ctx.font = `${Math.round(base * 0.03)}px '${theme.sans}'`;
    ctx.fillStyle = theme.subtle;
    ctx.textAlign = "center";
    ctx.textBaseline = "middle";
    ctx.fillText("No numeric data to chart", dims.width / 2, top + (dims.height - top) / 2);
    return false;
  }

  const plot = { x: pad, y: top, w: dims.width - pad * 2, h: dims.height - top - pad };

  if (scene.content.chartType === "pie") drawPie(ctx, p, plot);
  else drawBarOrLine(ctx, p, plot, base, scene.content.chartType, theme);

  drawLegend(ctx, legendItems(scene.content.chartType, p), dims, base, pad, theme);
  return true;
}

function drawBarOrLine(
  ctx: SKRSContext2D,
  p: Parsed,
  plot: { x: number; y: number; w: number; h: number },
  base: number,
  kind: "bar" | "line",
  theme: CanvasTheme,
): void {
  const allVals = p.series.flatMap((s) => s.values);
  const axisFont = Math.round(base * 0.022);
  const chartH = plot.h - axisFont * 2.5;
  const scale = valueScale(allVals, plot.y, chartH);
  const baseY = scale.yFor(0);

  // axis line
  ctx.strokeStyle = theme.cardBorder;
  ctx.lineWidth = 2;
  ctx.beginPath();
  ctx.moveTo(plot.x, baseY);
  ctx.lineTo(plot.x + plot.w, baseY);
  ctx.stroke();

  ctx.font = `${axisFont}px '${theme.sans}'`;
  ctx.textAlign = "center";
  ctx.textBaseline = "top";
  const groups = p.labels.length;
  const groupW = plot.w / groups;

  for (let g = 0; g < groups; g++) {
    const gx = plot.x + groupW * g;
    // label
    ctx.fillStyle = theme.subtle;
    ctx.fillText(p.labels[g]!, gx + groupW / 2, baseY + axisFont * 0.6);

    if (kind === "bar") {
      const barGap = groupW * 0.18;
      const barW = (groupW - barGap * 2) / p.series.length;
      const single = p.series.length === 1;
      p.series.forEach((s, si) => {
        const v = s.values[g]!;
        const y = scale.yFor(v);
        const h = Math.abs(baseY - y);
        const x = gx + barGap + barW * si;
        // Single series → color per label (matches the label legend); multi → per series.
        ctx.fillStyle = SERIES_COLORS[(single ? g : si) % SERIES_COLORS.length]!;
        ctx.fillRect(x, v >= 0 ? y : baseY, barW * 0.86, h);
        // value label outside the bar (skip zeros — they'd float with no bar)
        if (v !== 0) {
          ctx.fillStyle = theme.fg;
          ctx.textAlign = "center";
          ctx.textBaseline = v > 0 ? "bottom" : "top";
          ctx.fillText(String(v), x + barW * 0.43, y + (v > 0 ? -axisFont * 0.3 : axisFont * 0.3));
        }
      });
      ctx.textAlign = "center";
      ctx.textBaseline = "top";
    }
  }

  if (kind === "line") {
    p.series.forEach((s, si) => {
      ctx.strokeStyle = SERIES_COLORS[si % SERIES_COLORS.length]!;
      ctx.lineWidth = Math.max(2, base * 0.004);
      ctx.beginPath();
      s.values.forEach((v, g) => {
        const x = plot.x + groupW * (g + 0.5);
        const y = scale.yFor(v);
        if (g === 0) ctx.moveTo(x, y);
        else ctx.lineTo(x, y);
      });
      ctx.stroke();
    });
  }
}

function drawPie(ctx: SKRSContext2D, p: Parsed, plot: { x: number; y: number; w: number; h: number }): void {
  // Use the first series; slices per label.
  const values = p.series[0]?.values ?? [];
  const total = values.reduce((a, b) => a + b, 0) || 1;
  const cx = plot.x + plot.w / 2;
  const cy = plot.y + plot.h / 2;
  const r = Math.min(plot.w, plot.h) / 2.4;
  let angle = -Math.PI / 2;
  values.forEach((v, i) => {
    const slice = (v / total) * Math.PI * 2;
    ctx.beginPath();
    ctx.moveTo(cx, cy);
    ctx.arc(cx, cy, r, angle, angle + slice);
    ctx.closePath();
    ctx.fillStyle = SERIES_COLORS[i % SERIES_COLORS.length]!;
    ctx.fill();
    angle += slice;
  });
}

function drawLegend(
  ctx: SKRSContext2D,
  items: LegendItem[],
  dims: Dims,
  base: number,
  pad: number,
  theme: CanvasTheme,
): void {
  if (items.length <= 1) return;
  const fs = Math.round(base * 0.022);
  ctx.font = `${fs}px '${theme.sans}'`;
  ctx.textBaseline = "middle";
  ctx.textAlign = "left";
  const y = dims.height - pad * 0.45;
  let x = pad;
  items.forEach((item) => {
    ctx.fillStyle = SERIES_COLORS[item.colorIndex % SERIES_COLORS.length]!;
    ctx.fillRect(x, y - fs * 0.4, fs * 0.8, fs * 0.8);
    ctx.fillStyle = theme.subtle;
    ctx.fillText(item.label, x + fs * 1.1, y);
    x += fs * 1.1 + ctx.measureText(item.label).width + fs * 1.2;
  });
}
