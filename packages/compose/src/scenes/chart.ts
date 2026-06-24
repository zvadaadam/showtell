import type { SKRSContext2D } from "@napi-rs/canvas";
import type { ChartScene } from "@agent-video/core";
import { THEME } from "../theme.ts";
import type { Dims } from "../dims.ts";

const SERIES_COLORS = [
  "#7c8cff", "#7ee787", "#ffb86c", "#ff9492", "#79c0ff", "#d2a8ff",
  "#f2cc60", "#56d4bc", "#ff7b9c", "#9d8cff",
];

interface Parsed {
  labels: string[];
  series: { name: string; values: number[] }[];
}

function parse(data: Record<string, string | number>[]): Parsed {
  const keys = Object.keys(data[0] ?? {});
  const labelKey = keys.find((k) => typeof data[0]![k] === "string") ?? keys[0]!;
  const numKeys = keys.filter((k) => k !== labelKey && typeof data[0]![k] === "number");
  const numericKeys = numKeys.length ? numKeys : keys.filter((k) => k !== labelKey);
  return {
    labels: data.map((d) => String(d[labelKey] ?? "")),
    series: numericKeys.map((name) => ({ name, values: data.map((d) => Number(d[name]) || 0) })),
  };
}

export function drawChart(ctx: SKRSContext2D, scene: ChartScene, dims: Dims): void {
  const base = Math.min(dims.width, dims.height);
  const pad = Math.round(base * 0.1);
  const p = parse(scene.content.data as Record<string, string | number>[]);

  let top = pad;
  if (scene.content.title) {
    const tSize = Math.round(base * 0.045);
    ctx.font = `${tSize}px '${THEME.sansBold}'`;
    ctx.fillStyle = THEME.fg;
    ctx.textAlign = "center";
    ctx.textBaseline = "alphabetic";
    ctx.fillText(scene.content.title, dims.width / 2, top + tSize);
    top += tSize * 1.8;
  }

  const plot = { x: pad, y: top, w: dims.width - pad * 2, h: dims.height - top - pad };

  if (scene.content.chartType === "pie") drawPie(ctx, p, plot);
  else drawBarOrLine(ctx, p, plot, base, scene.content.chartType);

  drawLegend(ctx, p, dims, base, pad);
}

function drawBarOrLine(ctx: SKRSContext2D, p: Parsed, plot: { x: number; y: number; w: number; h: number }, base: number, kind: "bar" | "line"): void {
  const allVals = p.series.flatMap((s) => s.values);
  // Headroom so the tallest bar fills ~85% and value labels have room above.
  const max = Math.max(1, ...allVals) * 1.18;
  const axisFont = Math.round(base * 0.022);
  const chartH = plot.h - axisFont * 2.5;
  const baseY = plot.y + chartH;

  // axis line
  ctx.strokeStyle = THEME.cardBorder;
  ctx.lineWidth = 2;
  ctx.beginPath();
  ctx.moveTo(plot.x, baseY);
  ctx.lineTo(plot.x + plot.w, baseY);
  ctx.stroke();

  ctx.font = `${axisFont}px '${THEME.sans}'`;
  ctx.textAlign = "center";
  ctx.textBaseline = "top";
  const groups = p.labels.length;
  const groupW = plot.w / groups;

  for (let g = 0; g < groups; g++) {
    const gx = plot.x + groupW * g;
    // label
    ctx.fillStyle = THEME.subtle;
    ctx.fillText(p.labels[g]!, gx + groupW / 2, baseY + axisFont * 0.6);

    if (kind === "bar") {
      const barGap = groupW * 0.18;
      const barW = (groupW - barGap * 2) / p.series.length;
      const single = p.series.length === 1;
      p.series.forEach((s, si) => {
        const v = s.values[g]!;
        const h = (v / max) * chartH;
        const x = gx + barGap + barW * si;
        // Single series → color per label (matches the label legend); multi → per series.
        ctx.fillStyle = SERIES_COLORS[(single ? g : si) % SERIES_COLORS.length]!;
        ctx.fillRect(x, baseY - h, barW * 0.86, h);
        // value label above the bar (skip zeros — they'd float with no bar)
        if (v > 0) {
          ctx.fillStyle = THEME.fg;
          ctx.textAlign = "center";
          ctx.textBaseline = "bottom";
          ctx.fillText(String(v), x + barW * 0.43, baseY - h - axisFont * 0.3);
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
        const y = baseY - (v / max) * chartH;
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

function drawLegend(ctx: SKRSContext2D, p: Parsed, dims: Dims, base: number, pad: number): void {
  const items = p.series.length > 1 ? p.series.map((s) => s.name) : p.labels;
  if (items.length <= 1 && p.series.length <= 1) return;
  const fs = Math.round(base * 0.022);
  ctx.font = `${fs}px '${THEME.sans}'`;
  ctx.textBaseline = "middle";
  ctx.textAlign = "left";
  const y = dims.height - pad * 0.45;
  let x = pad;
  items.forEach((label, i) => {
    ctx.fillStyle = SERIES_COLORS[i % SERIES_COLORS.length]!;
    ctx.fillRect(x, y - fs * 0.4, fs * 0.8, fs * 0.8);
    ctx.fillStyle = THEME.subtle;
    ctx.fillText(label, x + fs * 1.1, y);
    x += fs * 1.1 + ctx.measureText(label).width + fs * 1.2;
  });
}
