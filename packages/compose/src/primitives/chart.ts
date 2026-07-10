import type { SKRSContext2D } from "@napi-rs/canvas";
import type { ChartScene } from "@showtell/core";
import { THEME, type CanvasTheme } from "../theme.ts";
import type { Dims } from "../dims.ts";
import { roundRect } from "../draw.ts";
import { clamp01, easeOutCubic } from "../hyperframe/motion.ts";

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

/**
 * Single-series bars draw in one accent hue (the x-axis labels already name
 * each bar), so only pies and multi-series charts need a legend.
 */
export function legendItems(chartType: ChartScene["content"]["chartType"], p: Parsed): LegendItem[] {
  if (chartType === "pie") return p.labels.map((label, i) => ({ label, colorIndex: i }));
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

/** Single series → the theme accent; multi-series → the theme's chart palette. */
function seriesColor(index: number, single: boolean, theme: CanvasTheme): string {
  if (single) return theme.accent;
  return theme.series[index % theme.series.length]!;
}

function withAlpha(color: string, alpha: number): string {
  if (!/^#[0-9a-fA-F]{6}$/.test(color)) return color; // non-hex: skip blending rather than emit rgba(NaN…)
  const normalized = color.replace("#", "");
  const r = parseInt(normalized.slice(0, 2), 16);
  const g = parseInt(normalized.slice(2, 4), 16);
  const b = parseInt(normalized.slice(4, 6), 16);
  return `rgba(${r}, ${g}, ${b}, ${alpha})`;
}

/** A bar with rounded top corners only (the base sits on the axis). */
function topRoundedBar(ctx: SKRSContext2D, x: number, y: number, w: number, h: number, r: number): void {
  const radius = Math.min(r, w / 2, h);
  ctx.beginPath();
  ctx.moveTo(x, y + h);
  ctx.lineTo(x, y + radius);
  ctx.arcTo(x, y, x + radius, y, radius);
  ctx.lineTo(x + w - radius, y);
  ctx.arcTo(x + w, y, x + w, y + radius, radius);
  ctx.lineTo(x + w, y + h);
  ctx.closePath();
}

export interface ChartMotion {
  /** ms since scene start for the frame being drawn; omit for stills (end state). */
  sceneMs: number;
}

function chartEnter(motion: ChartMotion | undefined, delayMs: number, durationMs: number): number {
  if (!motion) return 1;
  return easeOutCubic(clamp01((motion.sceneMs - delayMs) / durationMs));
}

/** Returns true if the chart had data to plot; false if it drew a "no data" placeholder. */
export function drawChart(
  ctx: SKRSContext2D,
  scene: ChartScene,
  dims: Dims,
  theme: CanvasTheme = THEME,
  motion?: ChartMotion,
): boolean {
  const base = Math.min(dims.width, dims.height);
  const pad = Math.round(base * 0.1);
  const p = parseChartData(scene.content.data as Record<string, string | number>[], {
    x: scene.content.x,
    y: scene.content.y,
  });

  let top = pad;
  if (scene.content.title) {
    const tSize = Math.round(base * 0.042);
    ctx.font = `${tSize}px '${theme.sansBold}', 'Inter Bold Greek', 'Noto Sans Math'`;
    ctx.fillStyle = theme.fg;
    ctx.textAlign = "center";
    ctx.textBaseline = "alphabetic";
    ctx.fillText(scene.content.title, dims.width / 2, top + tSize);
    top += tSize * 1.9;
  }

  // A datum can carry no numeric value (only a label) or be all zeros — draw a
  // visible placeholder instead of a blank/broken card, and let the caller warn.
  const hasData = p.series.length > 0 && p.series.some((s) => s.values.some((v) => v !== 0));
  if (!hasData) {
    ctx.font = `${Math.round(base * 0.03)}px '${theme.sans}', 'Inter Greek', 'Noto Sans Math'`;
    ctx.fillStyle = theme.subtle;
    ctx.textAlign = "center";
    ctx.textBaseline = "middle";
    ctx.fillText("No numeric data to chart", dims.width / 2, top + (dims.height - top) / 2);
    return false;
  }

  const legend = legendItems(scene.content.chartType, p);
  const legendH = legend.length > 0 ? Math.round(base * 0.05) : 0;
  const plot = { x: pad, y: top, w: dims.width - pad * 2, h: dims.height - top - pad - legendH };

  if (scene.content.chartType === "pie") drawPie(ctx, p, plot, theme, motion);
  else drawBarOrLine(ctx, p, plot, base, scene.content.chartType, theme, motion);

  drawLegend(ctx, legend, dims, base, pad, theme);
  return true;
}

function drawBarOrLine(
  ctx: SKRSContext2D,
  p: Parsed,
  plot: { x: number; y: number; w: number; h: number },
  base: number,
  kind: "bar" | "line",
  theme: CanvasTheme,
  motion?: ChartMotion,
): void {
  const allVals = p.series.flatMap((s) => s.values);
  const axisFont = Math.round(base * 0.022);
  const chartH = plot.h - axisFont * 2.5;
  const scale = valueScale(allVals, plot.y, chartH);
  const baseY = scale.yFor(0);
  const single = p.series.length === 1;

  // Horizontal gridlines make magnitudes readable without a full axis.
  const gridSteps = 4;
  ctx.lineWidth = 1;
  for (let i = 1; i <= gridSteps; i++) {
    const value = scale.min + ((scale.max - scale.min) / gridSteps) * i;
    const y = scale.yFor(value);
    if (Math.abs(y - baseY) < 4) continue;
    ctx.strokeStyle = withAlpha(theme.fg.startsWith("#") ? theme.fg : "#ffffff", 0.06);
    ctx.beginPath();
    ctx.moveTo(plot.x, y);
    ctx.lineTo(plot.x + plot.w, y);
    ctx.stroke();
  }

  // axis line
  ctx.strokeStyle = theme.cardBorder;
  ctx.lineWidth = 2;
  ctx.beginPath();
  ctx.moveTo(plot.x, baseY);
  ctx.lineTo(plot.x + plot.w, baseY);
  ctx.stroke();

  ctx.font = `${axisFont}px '${theme.sans}', 'Inter Greek', 'Noto Sans Math'`;
  ctx.textAlign = "center";
  ctx.textBaseline = "top";
  const groups = p.labels.length;
  const groupW = plot.w / groups;

  for (let g = 0; g < groups; g++) {
    const gx = plot.x + groupW * g;
    // label
    ctx.font = `${axisFont}px '${theme.sans}', 'Inter Greek', 'Noto Sans Math'`;
    ctx.fillStyle = theme.subtle;
    ctx.textAlign = "center";
    ctx.textBaseline = "top";
    ctx.fillText(p.labels[g]!, gx + groupW / 2, baseY + axisFont * 0.7);

    if (kind === "bar") {
      const barGap = groupW * 0.18;
      const barW = ((groupW - barGap * 2) / p.series.length) * 0.86;
      const slotW = (groupW - barGap * 2) / p.series.length;
      p.series.forEach((s, si) => {
        const v = s.values[g]!;
        const grow = chartEnter(motion, 150 + (g * p.series.length + si) * 90, 720);
        const y = scale.yFor(v);
        const fullH = Math.abs(baseY - y);
        const h = fullH * grow;
        const x = gx + barGap + slotW * si;
        const color = seriesColor(single ? 0 : si, single, theme);
        const barTop = v >= 0 ? baseY - h : baseY;
        const gradient = ctx.createLinearGradient(0, barTop, 0, barTop + Math.max(1, h));
        gradient.addColorStop(0, color);
        gradient.addColorStop(1, withAlpha(color, 0.62));
        ctx.fillStyle = gradient;
        if (h > 0) {
          topRoundedBar(ctx, x, barTop, barW, h, Math.min(10, barW * 0.28));
          ctx.fill();
        }
        // value label rides the bar top and fades in as the bar lands
        if (v !== 0 && grow > 0.55) {
          ctx.save();
          ctx.globalAlpha *= clamp01((grow - 0.55) / 0.45);
          ctx.font = `${Math.round(axisFont * 1.05)}px '${theme.sansBold}', 'Inter Bold Greek', 'Noto Sans Math'`;
          ctx.fillStyle = theme.fg;
          ctx.textAlign = "center";
          ctx.textBaseline = v > 0 ? "bottom" : "top";
          ctx.fillText(
            String(v),
            x + barW / 2,
            (v >= 0 ? barTop : baseY + h) + (v > 0 ? -axisFont * 0.35 : axisFont * 0.35),
          );
          ctx.restore();
        }
      });
    }
  }

  if (kind === "line") {
    const sweep = chartEnter(motion, 200, 950);
    p.series.forEach((s, si) => {
      const color = seriesColor(si, single, theme);
      const points = s.values.map((v, g) => ({
        x: plot.x + groupW * (g + 0.5),
        y: scale.yFor(v),
      }));
      if (points.length === 0) return;
      ctx.save();
      if (sweep < 1) {
        ctx.beginPath();
        ctx.rect(plot.x, plot.y - axisFont, plot.w * sweep, plot.h + axisFont * 2);
        ctx.clip();
      }

      if (single) {
        // Soft area fill under the single-series line.
        ctx.beginPath();
        ctx.moveTo(points[0]!.x, baseY);
        for (const point of points) ctx.lineTo(point.x, point.y);
        ctx.lineTo(points[points.length - 1]!.x, baseY);
        ctx.closePath();
        const area = ctx.createLinearGradient(0, plot.y, 0, baseY);
        area.addColorStop(0, withAlpha(color, 0.24));
        area.addColorStop(1, withAlpha(color, 0.02));
        ctx.fillStyle = area;
        ctx.fill();
      }

      ctx.strokeStyle = color;
      ctx.lineWidth = Math.max(3, base * 0.005);
      ctx.lineJoin = "round";
      ctx.lineCap = "round";
      ctx.beginPath();
      points.forEach((point, g) => {
        if (g === 0) ctx.moveTo(point.x, point.y);
        else ctx.lineTo(point.x, point.y);
      });
      ctx.stroke();

      const dotR = Math.max(4, base * 0.007);
      for (const point of points) {
        ctx.beginPath();
        ctx.arc(point.x, point.y, dotR, 0, Math.PI * 2);
        ctx.fillStyle = color;
        ctx.fill();
        ctx.beginPath();
        ctx.arc(point.x, point.y, dotR * 0.45, 0, Math.PI * 2);
        ctx.fillStyle = theme.codeBg;
        ctx.fill();
      }
      ctx.lineJoin = "miter";
      ctx.lineCap = "butt";
      ctx.restore();
    });
  }
}

function drawPie(
  ctx: SKRSContext2D,
  p: Parsed,
  plot: { x: number; y: number; w: number; h: number },
  theme: CanvasTheme,
  motion?: ChartMotion,
): void {
  // Use the first series; slices per label. With motion, the pie sweeps open.
  const values = p.series[0]?.values ?? [];
  const total = values.reduce((a, b) => a + b, 0) || 1;
  const cx = plot.x + plot.w / 2;
  const cy = plot.y + plot.h / 2;
  const r = Math.min(plot.w, plot.h) / 2.4;
  const sweep = chartEnter(motion, 150, 850) * Math.PI * 2;
  let angle = -Math.PI / 2;
  for (let i = 0; i < values.length; i++) {
    const slice = (values[i]! / total) * Math.PI * 2;
    const start = angle + Math.PI / 2; // angle relative to the sweep origin
    const visible = Math.max(0, Math.min(slice, sweep - start));
    if (visible > 0) {
      ctx.beginPath();
      ctx.moveTo(cx, cy);
      ctx.arc(cx, cy, r, angle, angle + visible);
      ctx.closePath();
      ctx.fillStyle = theme.series[i % theme.series.length]!;
      ctx.fill();
      ctx.strokeStyle = theme.codeBg;
      ctx.lineWidth = Math.max(2, r * 0.02);
      ctx.stroke();
    }
    angle += slice;
  }
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
  ctx.font = `${fs}px '${theme.sans}', 'Inter Greek', 'Noto Sans Math'`;
  ctx.textBaseline = "middle";
  ctx.textAlign = "left";
  const swatch = fs * 0.75;
  const itemWidths = items.map((item) => swatch + fs * 0.55 + ctx.measureText(item.label).width);
  const totalW = itemWidths.reduce((sum, w) => sum + w, 0) + fs * 1.4 * (items.length - 1);
  const y = dims.height - pad * 0.5;
  let x = Math.max(pad, (dims.width - totalW) / 2);
  items.forEach((item, i) => {
    ctx.fillStyle = theme.series[item.colorIndex % theme.series.length]!;
    roundRect(ctx, x, y - swatch / 2, swatch, swatch, Math.max(2, swatch * 0.3));
    ctx.fill();
    ctx.fillStyle = theme.subtle;
    ctx.fillText(item.label, x + swatch + fs * 0.55, y);
    x += itemWidths[i]! + fs * 1.4;
  });
}
