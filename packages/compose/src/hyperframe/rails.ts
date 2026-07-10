/** Progress rails and process maps. */
import type { SKRSContext2D } from "@napi-rs/canvas";
import type { HyperframeElement } from "@showtell/hyperframes";
import { roundRect, wrapText } from "../draw.ts";
import { propsOf, type Box } from "../render-hyperframe-shared.ts";
import { easeOutBack, easeOutCubic, enter01, pulse01 } from "./motion.ts";
import { fontFor, truncateToWidth } from "./typography.ts";
import { rgba, type RenderEnv } from "./tokens.ts";

export function drawTimelineRail(ctx: SKRSContext2D, element: HyperframeElement, box: Box, env: RenderEnv): void {
  const props = propsOf(element);
  const labels = Array.isArray(props.steps)
    ? props.steps.filter((step): step is string => typeof step === "string")
    : [];
  if (labels.length === 0) return;
  const activeIndex = Math.max(
    0,
    Math.min(labels.length - 1, typeof props.activeIndex === "number" ? props.activeIndex : 0),
  );
  const targetProgress =
    typeof props.progress === "number"
      ? Math.max(0, Math.min(1, props.progress))
      : labels.length <= 1
        ? 1
        : activeIndex / (labels.length - 1);
  const progress = targetProgress * easeOutCubic(enter01(env, 200, 850));
  const base = Math.min(env.dims.width, env.dims.height);
  const labelSize = Math.max(14, Math.round(base * 0.018));
  const dotY = box.y + box.h * 0.38;
  const inset = Math.round(base * 0.02);
  const start = box.x + inset;
  const end = box.x + box.w - inset;

  ctx.lineCap = "round";
  ctx.strokeStyle = rgba(env.palette.fg, 0.14);
  ctx.lineWidth = 3;
  ctx.beginPath();
  ctx.moveTo(start, dotY);
  ctx.lineTo(end, dotY);
  ctx.stroke();
  if (progress > 0) {
    ctx.strokeStyle = env.palette.accent;
    ctx.beginPath();
    ctx.moveTo(start, dotY);
    ctx.lineTo(start + (end - start) * progress, dotY);
    ctx.stroke();
  }
  ctx.lineCap = "butt";

  const slotW = (end - start) / Math.max(1, labels.length - 1);
  labels.forEach((label, i) => {
    const x = labels.length === 1 ? (start + end) / 2 : start + slotW * i;
    const active = i === activeIndex;
    if (active) {
      const breathe = pulse01(env);
      ctx.beginPath();
      ctx.arc(x, dotY, Math.round(base * 0.019) * (1 + breathe * 0.18), 0, Math.PI * 2);
      ctx.fillStyle = rgba(env.palette.accent, 0.18 + breathe * 0.1);
      ctx.fill();
    }
    ctx.beginPath();
    ctx.arc(x, dotY, active ? Math.round(base * 0.01) : Math.round(base * 0.0068), 0, Math.PI * 2);
    if (i <= activeIndex) {
      ctx.fillStyle = env.palette.accent;
      ctx.fill();
    } else {
      ctx.fillStyle = env.palette.bg;
      ctx.fill();
      ctx.strokeStyle = rgba(env.palette.fg, 0.3);
      ctx.lineWidth = 2;
      ctx.stroke();
    }

    ctx.font = fontFor(env, active ? "semibold" : "medium", labelSize);
    ctx.fillStyle = active ? env.palette.fg : env.palette.subtle;
    ctx.textBaseline = "top";
    const text = truncateToWidth(ctx, label, slotW * 0.92);
    const halfW = ctx.measureText(text).width / 2;
    const cx = Math.max(box.x + halfW, Math.min(box.x + box.w - halfW, x));
    ctx.textAlign = "center";
    ctx.fillText(text, cx, dotY + Math.round(base * 0.026));
  });
}

export function drawSystemMap(ctx: SKRSContext2D, element: HyperframeElement, box: Box, env: RenderEnv): void {
  const props = propsOf(element);
  const steps = Array.isArray(props.steps)
    ? props.steps.filter((step): step is string => typeof step === "string")
    : [];
  const labels = steps.length ? steps : ["Gather", "Author", "Compile", "Render", "Verify"];
  const activeIndex = Math.max(
    0,
    Math.min(labels.length - 1, typeof props.activeIndex === "number" ? props.activeIndex : 0),
  );
  const base = Math.min(env.dims.width, env.dims.height);
  const requested = props.orientation;
  const horizontal = requested === "horizontal" ? true : requested === "vertical" ? false : box.w > box.h * 1.2;
  const count = labels.length;
  // Shrink connectors before letting nodes collapse when many steps compete
  // for a small box; geometry stays positive for any steps.length.
  const span = horizontal ? box.w : box.h;
  const arrow = Math.max(2, Math.min(Math.round(base * 0.036), Math.floor(span / Math.max(1, count * 3))));
  const labelSize = Math.max(15, Math.round(base * 0.021));
  const chipR = Math.round(base * 0.016);

  const nodeW = horizontal ? Math.max(1, (box.w - arrow * (count - 1)) / count) : Math.min(box.w, base * 0.62);
  const nodeH = horizontal
    ? Math.min(box.h, Math.max(base * 0.13, Math.min(base * 0.2, box.h * 0.52)))
    : Math.max(1, (box.h - arrow * (count - 1)) / count);
  const startY = horizontal ? box.y + (box.h - nodeH) / 2 : box.y;
  const startX = horizontal ? box.x : box.x + (box.w - nodeW) / 2;

  for (let i = 0; i < count; i++) {
    const x = horizontal ? box.x + i * (nodeW + arrow) : startX;
    const y = horizontal ? startY : box.y + i * (nodeH + arrow);
    const active = i === activeIndex;
    const visited = i < activeIndex;
    const radius = Math.min(18, Math.round(base * 0.016));
    // Nodes cascade in; each pulls its outgoing arrow along after it.
    const nodeT = enter01(env, 200 + i * 120, 520);
    ctx.save();
    ctx.globalAlpha *= easeOutCubic(nodeT);

    roundRect(ctx, x, y, nodeW, nodeH, radius);
    ctx.fillStyle = active
      ? rgba(env.palette.accent, env.palette.isLight ? 0.1 : 0.16)
      : rgba(env.palette.surface, env.palette.isLight ? 0.85 : 0.5);
    ctx.fill();
    ctx.strokeStyle = active ? rgba(env.palette.accent, 0.65) : rgba(env.palette.fg, visited ? 0.16 : 0.1);
    ctx.lineWidth = active ? 2.5 : 1.5;
    ctx.stroke();

    const centerX = x + nodeW / 2;
    const chipY = y + nodeH * 0.34;
    const chipScale = Math.max(0.01, easeOutBack(nodeT));
    ctx.beginPath();
    ctx.arc(centerX, chipY, chipR * chipScale, 0, Math.PI * 2);
    if (active) {
      ctx.fillStyle = env.palette.accent;
      ctx.fill();
    } else if (visited) {
      ctx.fillStyle = rgba(env.palette.accent, 0.2);
      ctx.fill();
    } else {
      ctx.fillStyle = rgba(env.palette.fg, 0.08);
      ctx.fill();
    }
    ctx.font = fontFor(env, "semibold", Math.round(chipR * 1.15));
    ctx.fillStyle = active
      ? env.palette.isLight
        ? "#ffffff"
        : env.palette.bg
      : visited
        ? env.palette.accent
        : env.palette.subtle;
    ctx.textAlign = "center";
    ctx.textBaseline = "middle";
    ctx.fillText(String(i + 1), centerX, chipY + chipR * 0.06);

    ctx.font = fontFor(env, active ? "semibold" : "medium", labelSize);
    ctx.fillStyle = active || visited ? env.palette.fg : env.palette.subtle;
    const lines = wrapText(ctx, labels[i]!, nodeW * 0.86).slice(0, 2);
    const labelY = y + nodeH * 0.66;
    lines.forEach((line, lineIndex) => {
      ctx.fillText(line, centerX, labelY + (lineIndex - (lines.length - 1) / 2) * labelSize * 1.25);
    });

    if (i < count - 1) {
      const done = i < activeIndex;
      ctx.strokeStyle = done ? rgba(env.palette.accent, 0.6) : rgba(env.palette.fg, 0.22);
      ctx.fillStyle = ctx.strokeStyle;
      ctx.lineWidth = 2.5;
      ctx.lineCap = "round";
      const head = Math.round(arrow * 0.22);
      if (horizontal) {
        const ax0 = x + nodeW + arrow * 0.22;
        const ax1 = x + nodeW + arrow * 0.78;
        const ay = y + nodeH / 2;
        ctx.beginPath();
        ctx.moveTo(ax0, ay);
        ctx.lineTo(ax1 - head * 0.7, ay);
        ctx.stroke();
        ctx.beginPath();
        ctx.moveTo(ax1, ay);
        ctx.lineTo(ax1 - head, ay - head * 0.7);
        ctx.lineTo(ax1 - head, ay + head * 0.7);
        ctx.closePath();
        ctx.fill();
      } else {
        const ay0 = y + nodeH + arrow * 0.22;
        const ay1 = y + nodeH + arrow * 0.78;
        ctx.beginPath();
        ctx.moveTo(centerX, ay0);
        ctx.lineTo(centerX, ay1 - head * 0.7);
        ctx.stroke();
        ctx.beginPath();
        ctx.moveTo(centerX, ay1);
        ctx.lineTo(centerX - head * 0.7, ay1 - head);
        ctx.lineTo(centerX + head * 0.7, ay1 - head);
        ctx.closePath();
        ctx.fill();
      }
      ctx.lineCap = "butt";
    }
    ctx.restore();
  }
}
