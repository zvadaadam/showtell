import type { Scene } from "@showtell/core";

export type SimpleWebScene = Exclude<Scene, { kind: "screencap" }>;

export interface SimpleWebManifest {
  schemaVersion: 3;
  propsSchema: Record<string, unknown>;
  inputs: Record<string, Record<string, unknown>>;
}

const REVEAL_INPUT = { kind: "range" } as const;

const MANIFESTS = {
  title: {
    schemaVersion: 3,
    propsSchema: {
      type: "object",
      additionalProperties: false,
      required: ["heading"],
      properties: {
        heading: { type: "string", minLength: 1 },
        subtitle: { type: "string" },
      },
    },
    inputs: { reveal: REVEAL_INPUT },
  },
  code: {
    schemaVersion: 3,
    propsSchema: {
      type: "object",
      additionalProperties: false,
      required: ["file"],
      properties: { file: { type: "string", minLength: 1 } },
    },
    inputs: {
      source: { kind: "repo", refKind: "code" },
      reveal: REVEAL_INPUT,
    },
  },
  diff: {
    schemaVersion: 3,
    propsSchema: {
      type: "object",
      additionalProperties: false,
      required: ["file", "ref", "animation"],
      properties: {
        file: { type: "string", minLength: 1 },
        ref: { type: "string", minLength: 1 },
        animation: { type: "string", enum: ["magic-move", "fade"] },
      },
    },
    inputs: {
      source: { kind: "repo", refKind: "diff" },
      reveal: REVEAL_INPUT,
    },
  },
  "talking-points": {
    schemaVersion: 3,
    propsSchema: {
      type: "object",
      additionalProperties: false,
      required: ["points"],
      properties: {
        heading: { type: "string" },
        points: {
          type: "array",
          minItems: 1,
          items: { type: "string", minLength: 1 },
        },
      },
    },
    inputs: { reveal: REVEAL_INPUT },
  },
  chart: {
    schemaVersion: 3,
    propsSchema: {
      type: "object",
      additionalProperties: false,
      required: ["chartType"],
      properties: {
        chartType: { type: "string", enum: ["bar", "line", "pie"] },
        title: { type: "string" },
        x: { type: "string" },
        y: { type: "string" },
      },
    },
    inputs: {
      data: { kind: "asset", assetType: "data" },
      reveal: REVEAL_INPUT,
    },
  },
} as const satisfies Record<SimpleWebScene["kind"], SimpleWebManifest>;

const BASE_CSS = `
      :root { color-scheme: dark; }
      html, body { width: 100%; height: 100%; margin: 0; overflow: hidden; }
      body {
        background: var(--st-bg);
        color: var(--st-fg);
        font-family: var(--st-font-body, Inter), sans-serif;
      }
      *, *::before, *::after { box-sizing: border-box; }
      .scene {
        position: relative;
        width: 100vw;
        height: 100vh;
        overflow: hidden;
        isolation: isolate;
        background:
          radial-gradient(circle at 16% 12%, color-mix(in srgb, var(--st-accent) 18%, transparent), transparent 34%),
          var(--st-bg);
      }
      .safe {
        position: absolute;
        inset:
          max(4vh, var(--st-safe-top))
          max(5vw, var(--st-safe-right))
          max(5vh, var(--st-safe-bottom))
          max(5vw, var(--st-safe-left));
      }
      .grain {
        position: absolute;
        inset: 0;
        opacity: .16;
        background-image:
          linear-gradient(90deg, transparent 49.8%, color-mix(in srgb, var(--st-border) 42%, transparent) 50%, transparent 50.2%),
          linear-gradient(transparent 49.8%, color-mix(in srgb, var(--st-border) 42%, transparent) 50%, transparent 50.2%);
        background-size: clamp(70px, 7vw, 132px) clamp(70px, 7vw, 132px);
        mask-image: radial-gradient(circle at 50% 48%, black 8%, transparent 78%);
      }
      .registration {
        position: absolute;
        z-index: 8;
        color: var(--st-subtle);
        font: 600 clamp(14px, 1vw, 19px) / 1 var(--st-font-mono, "JetBrains Mono"), monospace;
        letter-spacing: .12em;
        text-transform: uppercase;
      }
      .registration.top { top: max(2.8vh, var(--st-safe-top)); left: max(3vw, var(--st-safe-left)); }
      .registration.bottom { right: max(3vw, var(--st-safe-right)); bottom: max(2.8vh, var(--st-safe-bottom)); }
      @media (max-aspect-ratio: 4 / 5) {
        .safe {
          inset:
            max(4vh, var(--st-safe-top))
            max(7vw, var(--st-safe-right))
            max(5vh, var(--st-safe-bottom))
            max(7vw, var(--st-safe-left));
        }
        .registration { font-size: clamp(14px, 2.6vw, 19px); }
      }
    `;

const TITLE_CSS = `
      .title-scene { background: var(--st-bg); }
      .title-scene .grain {
        opacity: .28;
        background-size: clamp(58px, 5.8vw, 112px) clamp(58px, 5.8vw, 112px);
      }
      .title-halo {
        position: absolute;
        top: -28vh;
        right: -12vw;
        width: min(72vw, 980px);
        aspect-ratio: 1;
        border: clamp(34px, 5vw, 82px) solid color-mix(in srgb, var(--st-accent) 78%, transparent);
        border-radius: 50%;
        opacity: .62;
        box-shadow:
          0 0 110px color-mix(in srgb, var(--st-accent) 36%, transparent),
          inset 0 0 76px color-mix(in srgb, var(--st-accent) 26%, transparent);
      }
      .title-axis {
        position: absolute;
        top: 0;
        bottom: 0;
        left: 19vw;
        width: 2px;
        background: color-mix(in srgb, var(--st-border) 80%, transparent);
        transform-origin: top center;
      }
      .title-copy {
        position: absolute;
        z-index: 4;
        right: 2vw;
        bottom: 9vh;
        left: 0;
      }
      .title-kicker {
        margin: 0 0 2.4vh .5vw;
        color: var(--st-accent);
        font: 600 clamp(17px, 1.25vw, 24px) / 1 var(--st-font-mono, "Space Mono"), monospace;
        letter-spacing: .18em;
        text-transform: uppercase;
      }
      .title-heading {
        max-width: 90%;
        margin: 0;
        font: 400 clamp(104px, 12.8vw, 236px) / .76 var(--st-font-display, "League Gothic"), sans-serif;
        letter-spacing: -.025em;
        text-transform: uppercase;
        text-wrap: balance;
      }
      .title-subtitle {
        max-width: min(58vw, 920px);
        margin: 3.4vh 0 0 .5vw;
        color: var(--st-subtle);
        font-size: clamp(24px, 2vw, 38px);
        line-height: 1.25;
      }
      .title-signal {
        position: absolute;
        z-index: 5;
        right: 0;
        bottom: 0;
        left: 0;
        height: 6px;
        border-radius: 99px;
        background: color-mix(in srgb, var(--st-border) 52%, transparent);
        overflow: hidden;
      }
      .title-signal-fill {
        width: 100%;
        height: 100%;
        background: var(--st-accent);
        transform-origin: left center;
        box-shadow: 0 0 28px color-mix(in srgb, var(--st-accent) 82%, transparent);
      }
      .title-ordinal {
        position: absolute;
        z-index: 2;
        top: 8vh;
        right: 1vw;
        color: color-mix(in srgb, var(--st-fg) 12%, transparent);
        font: 400 clamp(180px, 29vw, 520px) / .8 var(--st-font-display, "League Gothic"), sans-serif;
      }
      @media (max-aspect-ratio: 4 / 5) {
        .title-halo { top: -8vh; right: -54vw; width: 132vw; }
        .title-axis { left: 14vw; }
        .title-copy { right: 0; bottom: 11vh; }
        .title-heading { max-width: 100%; font-size: clamp(112px, 23vw, 244px); line-height: .8; }
        .title-subtitle { max-width: 94%; margin-top: 3vh; font-size: clamp(26px, 4.8vw, 38px); }
        .title-ordinal { top: 11vh; right: -4vw; font-size: 48vw; }
      }
    `;

const CODE_CSS = `
      .code-scene .safe { display: grid; grid-template-columns: minmax(210px, 22vw) minmax(0, 1fr); gap: clamp(34px, 4vw, 84px); }
      .code-rail {
        position: relative;
        z-index: 3;
        display: flex;
        flex-direction: column;
        justify-content: flex-end;
        padding-bottom: 4vh;
      }
      .code-live {
        display: flex;
        align-items: center;
        gap: 12px;
        color: var(--st-accent);
        font: 600 clamp(16px, 1.1vw, 22px) / 1 var(--st-font-mono, "Space Mono"), monospace;
        letter-spacing: .15em;
        text-transform: uppercase;
      }
      .code-live-dot {
        width: 14px;
        height: 14px;
        border: 3px solid var(--st-bg);
        border-radius: 50%;
        background: var(--st-accent);
        box-shadow: 0 0 0 2px var(--st-accent), 0 0 26px var(--st-accent);
      }
      .code-file {
        margin-top: 2.5vh;
        color: var(--st-fg);
        font: 400 clamp(48px, 4.8vw, 88px) / .92 var(--st-font-display, "League Gothic"), sans-serif;
        overflow-wrap: anywhere;
        text-transform: uppercase;
      }
      .code-note {
        display: grid;
        gap: 4px;
        margin-top: 2.2vh;
        color: var(--st-subtle);
        font: 500 clamp(15px, 1vw, 20px) / 1.45 var(--st-font-mono, "JetBrains Mono"), monospace;
      }
      .code-rule {
        position: absolute;
        top: 0;
        bottom: 0;
        left: calc(22vw + max(5vw, var(--st-safe-left)) + clamp(17px, 2vw, 42px));
        width: 2px;
        background: var(--st-accent);
        transform-origin: top center;
      }
      .code-stage {
        position: relative;
        z-index: 3;
        min-width: 0;
        min-height: 0;
        padding: 5vh 0 2vh;
        filter: drop-shadow(0 30px 72px rgba(0, 0, 0, .34));
      }
      .code-stage st-code { width: 100%; height: 100%; }
      .code-scan {
        position: absolute;
        z-index: 5;
        right: 0;
        bottom: 0;
        left: 0;
        height: 5px;
        background: var(--st-accent);
        transform-origin: left center;
      }
      .code-ghost {
        position: absolute;
        top: 7vh;
        left: -2vw;
        color: color-mix(in srgb, var(--st-accent) 10%, transparent);
        font: 400 min(25vw, 420px) / .8 var(--st-font-display, "League Gothic"), sans-serif;
        letter-spacing: -.03em;
      }
      @media (max-aspect-ratio: 4 / 5) {
        .code-scene .safe { grid-template-columns: 1fr; grid-template-rows: auto minmax(0, 1fr); gap: 2.5vh; }
        .code-rail { display: grid; grid-template-columns: auto minmax(0, 1fr); align-items: end; gap: 5vw; padding: 5vh 0 0; }
        .code-live { align-self: start; font-size: clamp(15px, 2.7vw, 20px); }
        .code-file { margin: 0; font-size: clamp(58px, 11vw, 92px); text-align: right; }
        .code-note { display: none; }
        .code-rule { top: 25vh; right: max(7vw, var(--st-safe-right)); bottom: auto; left: max(7vw, var(--st-safe-left)); width: auto; height: 2px; transform-origin: left center; }
        .code-stage { padding: 0 0 2vh; }
        .code-ghost { top: 8vh; left: -8vw; font-size: 42vw; }
      }
    `;

const DIFF_CSS = `
      .diff-scene {
        background:
          radial-gradient(circle at 4% 92%, color-mix(in srgb, var(--st-warning) 20%, transparent), transparent 30%),
          radial-gradient(circle at 96% 8%, color-mix(in srgb, var(--st-success) 22%, transparent), transparent 34%),
          var(--st-bg);
      }
      .diff-scene .safe { display: grid; grid-template-rows: auto minmax(0, 1fr); gap: 3vh; }
      .diff-header {
        position: relative;
        z-index: 4;
        display: grid;
        grid-template-columns: minmax(0, 1fr) auto;
        align-items: end;
        gap: 4vw;
        padding-top: 3vh;
      }
      .diff-file {
        font: 400 clamp(64px, 7vw, 126px) / .84 var(--st-font-display, "League Gothic"), sans-serif;
        letter-spacing: -.018em;
        overflow-wrap: anywhere;
        text-transform: uppercase;
      }
      .diff-ref {
        max-width: 34vw;
        padding-bottom: .7vh;
        color: var(--st-subtle);
        font: 500 clamp(16px, 1.15vw, 22px) / 1.3 var(--st-font-mono, "JetBrains Mono"), monospace;
        text-align: right;
        overflow-wrap: anywhere;
      }
      .diff-ref strong { display: block; margin-bottom: 9px; color: var(--st-accent); letter-spacing: .12em; text-transform: uppercase; }
      .diff-stage {
        position: relative;
        z-index: 4;
        min-height: 0;
        padding-bottom: 2vh;
        filter: drop-shadow(0 30px 78px rgba(0, 0, 0, .36));
      }
      .diff-stage st-diff { width: 100%; height: 100%; }
      .diff-split {
        position: absolute;
        z-index: 2;
        top: -12vh;
        bottom: -12vh;
        left: 50%;
        width: 5px;
        background: linear-gradient(var(--st-success), var(--st-accent), var(--st-warning));
        transform: rotate(24deg);
        transform-origin: center;
        opacity: .68;
      }
      .diff-symbol {
        position: absolute;
        z-index: 1;
        color: color-mix(in srgb, var(--st-fg) 10%, transparent);
        font: 400 min(32vw, 520px) / .7 var(--st-font-display, "League Gothic"), sans-serif;
      }
      .diff-symbol.plus { top: 4vh; right: 3vw; color: color-mix(in srgb, var(--st-success) 14%, transparent); }
      .diff-symbol.minus { bottom: 1vh; left: 2vw; color: color-mix(in srgb, var(--st-warning) 14%, transparent); }
      .diff-mode {
        position: absolute;
        z-index: 7;
        bottom: max(2.8vh, var(--st-safe-bottom));
        left: max(3vw, var(--st-safe-left));
        color: var(--st-subtle);
        font: 600 clamp(14px, 1vw, 19px) / 1 var(--st-font-mono, "Space Mono"), monospace;
        letter-spacing: .14em;
        text-transform: uppercase;
      }
      @media (max-aspect-ratio: 4 / 5) {
        .diff-scene .safe { gap: 2vh; }
        .diff-header { grid-template-columns: 1fr; gap: 1.5vh; padding-top: 6vh; }
        .diff-file { font-size: clamp(68px, 13vw, 112px); }
        .diff-ref { max-width: 100%; padding: 0; font-size: clamp(15px, 2.7vw, 20px); text-align: left; }
        .diff-ref strong { display: inline; margin: 0 12px 0 0; }
        .diff-stage { padding-bottom: 4vh; }
        .diff-split { left: 46%; transform: rotate(14deg); }
        .diff-symbol { font-size: 48vw; }
        .diff-mode { bottom: max(2.4vh, var(--st-safe-bottom)); font-size: clamp(14px, 2.6vw, 18px); }
      }
    `;

const TALKING_POINTS_CSS = `
      .points-scene { background: var(--st-bg); }
      .points-orbit {
        position: absolute;
        top: -28vh;
        left: -14vw;
        width: min(68vw, 940px);
        aspect-ratio: 1;
        border: 3px solid color-mix(in srgb, var(--st-accent) 48%, transparent);
        border-radius: 50%;
        box-shadow: inset 0 0 96px color-mix(in srgb, var(--st-accent) 15%, transparent);
      }
      .points-orbit::after {
        content: "";
        position: absolute;
        inset: 12%;
        border: 2px dashed color-mix(in srgb, var(--st-border) 78%, transparent);
        border-radius: 50%;
      }
      .points-scene .safe {
        display: grid;
        grid-template-columns: minmax(190px, 23vw) minmax(0, 1fr);
        gap: clamp(42px, 5vw, 100px);
        padding-top: 6vh;
        padding-bottom: 3vh;
      }
      .points-heading-wrap {
        position: relative;
        z-index: 3;
        align-self: start;
        padding-top: 2vh;
      }
      .points-kicker {
        color: var(--st-accent);
        font: 600 clamp(16px, 1.1vw, 21px) / 1 var(--st-font-mono, "Space Mono"), monospace;
        letter-spacing: .18em;
        text-transform: uppercase;
      }
      .points-heading {
        margin-top: 2.2vh;
        font: 400 clamp(58px, 5.4vw, 98px) / .9 var(--st-font-display, "League Gothic"), sans-serif;
        letter-spacing: -.018em;
        text-transform: uppercase;
      }
      .points-count {
        margin-top: 3vh;
        color: var(--st-subtle);
        font: 500 clamp(15px, 1vw, 19px) / 1.4 var(--st-font-mono, "JetBrains Mono"), monospace;
      }
      .points-sequence {
        position: relative;
        z-index: 4;
        min-width: 0;
        align-self: center;
        margin: 0;
        padding: 0;
        list-style: none;
      }
      .point {
        display: grid;
        grid-template-columns: clamp(58px, 5vw, 94px) minmax(0, 1fr);
        align-items: center;
        gap: clamp(18px, 2.2vw, 42px);
        min-height: clamp(104px, 13vh, 152px);
        border-top: 2px solid color-mix(in srgb, var(--st-border) 76%, transparent);
      }
      .point:last-child { border-bottom: 2px solid color-mix(in srgb, var(--st-border) 76%, transparent); }
      .point-index {
        color: var(--st-accent);
        font: 600 clamp(17px, 1.2vw, 23px) / 1 var(--st-font-mono, "Space Mono"), monospace;
      }
      .point-copy {
        max-width: 96%;
        font-size: clamp(31px, 3vw, 56px);
        font-weight: 650;
        line-height: 1.03;
        letter-spacing: -.025em;
        text-wrap: balance;
      }
      .points-progress {
        position: absolute;
        z-index: 5;
        top: 0;
        right: 0;
        bottom: 0;
        width: 7px;
        border-radius: 99px;
        background: color-mix(in srgb, var(--st-border) 58%, transparent);
        overflow: hidden;
      }
      .points-progress-fill {
        width: 100%;
        height: 100%;
        background: var(--st-accent);
        transform-origin: top center;
      }
      @media (max-aspect-ratio: 4 / 5) {
        .points-orbit { top: -6vh; left: -70vw; width: 150vw; }
        .points-scene .safe { grid-template-columns: 1fr; grid-template-rows: auto minmax(0, 1fr); gap: 3vh; padding-top: 7vh; }
        .points-heading-wrap { display: grid; grid-template-columns: auto minmax(0, 1fr); align-items: end; gap: 4vw; padding: 0; }
        .points-kicker { align-self: start; font-size: clamp(15px, 2.8vw, 20px); }
        .points-heading { margin: 0; font-size: clamp(60px, 12vw, 102px); text-align: right; }
        .points-count { display: none; }
        .point { grid-template-columns: clamp(48px, 10vw, 76px) minmax(0, 1fr); min-height: clamp(104px, 13vh, 164px); }
        .point-index { font-size: clamp(16px, 3vw, 22px); }
        .point-copy { font-size: clamp(30px, 6vw, 48px); }
      }
    `;

const CHART_CSS = `
      .chart-scene {
        background:
          radial-gradient(circle at 88% 22%, color-mix(in srgb, var(--st-accent-2) 22%, transparent), transparent 32%),
          radial-gradient(circle at 10% 86%, color-mix(in srgb, var(--st-accent) 17%, transparent), transparent 30%),
          var(--st-bg);
      }
      .chart-scene .safe { display: grid; grid-template-columns: minmax(180px, 16vw) minmax(0, 1fr); gap: clamp(30px, 3.5vw, 72px); }
      .chart-rail {
        position: relative;
        z-index: 4;
        display: flex;
        flex-direction: column;
        justify-content: space-between;
        padding: 6vh 0 4vh;
      }
      .chart-kind {
        color: var(--st-accent);
        font: 600 clamp(17px, 1.2vw, 23px) / 1 var(--st-font-mono, "Space Mono"), monospace;
        letter-spacing: .16em;
        text-transform: uppercase;
      }
      .chart-word {
        font: 400 clamp(78px, 8.5vw, 154px) / .76 var(--st-font-display, "League Gothic"), sans-serif;
        letter-spacing: -.02em;
        text-transform: uppercase;
        writing-mode: vertical-rl;
        transform: rotate(180deg);
      }
      .chart-fields {
        color: var(--st-subtle);
        font: 500 clamp(14px, .95vw, 18px) / 1.5 var(--st-font-mono, "JetBrains Mono"), monospace;
      }
      .chart-stage {
        position: relative;
        z-index: 4;
        min-width: 0;
        min-height: 0;
        padding: 5vh 0 3vh;
        filter: drop-shadow(0 34px 82px rgba(0, 0, 0, .32));
      }
      .chart-stage st-chart { width: 100%; height: 100%; }
      .chart-baseline {
        position: absolute;
        z-index: 5;
        right: 0;
        bottom: 1vh;
        left: 0;
        height: 5px;
        background: var(--st-accent);
        transform-origin: left center;
      }
      .chart-ghost {
        position: absolute;
        z-index: 1;
        top: 0;
        right: -2vw;
        color: color-mix(in srgb, var(--st-accent-2) 11%, transparent);
        font: 400 min(27vw, 450px) / .8 var(--st-font-display, "League Gothic"), sans-serif;
      }
      @media (max-aspect-ratio: 4 / 5) {
        .chart-scene .safe { grid-template-columns: 1fr; grid-template-rows: auto minmax(0, 1fr); gap: 1vh; }
        .chart-rail { display: grid; grid-template-columns: auto minmax(0, 1fr) auto; align-items: end; gap: 5vw; padding: 6vh 0 0; }
        .chart-kind { align-self: start; font-size: clamp(15px, 2.8vw, 20px); }
        .chart-word { font-size: clamp(62px, 12vw, 104px); writing-mode: initial; transform: none; text-align: center; }
        .chart-fields { font-size: clamp(13px, 2.5vw, 18px); text-align: right; }
        .chart-stage { padding: 1vh 0 4vh; }
        .chart-ghost { top: 10vh; right: -8vw; font-size: 44vw; }
      }
    `;

const TITLE_BODY = `
    <main class="scene title-scene">
      <div class="grain"></div>
      <div class="title-halo"></div>
      <div class="title-axis"></div>
      <div class="title-ordinal">01</div>
      <div class="registration top">Showtell / chapter</div>
      <div class="registration bottom">Exact motion / v3</div>
      <div class="safe">
        <section class="title-copy">
          <div class="title-kicker">Now entering</div>
          <h1 class="title-heading"></h1>
          <p class="title-subtitle"></p>
        </section>
        <div class="title-signal"><div class="title-signal-fill"></div></div>
      </div>
    </main>`;

const TITLE_SCRIPT = `
      const st = window.__showtell;
      const reveal = st.range("reveal");
      const heading = document.querySelector(".title-heading");
      const subtitle = document.querySelector(".title-subtitle");
      heading.textContent = st.props.heading;
      subtitle.textContent = typeof st.props.subtitle === "string" ? st.props.subtitle : "";
      const entrance = Math.max(0.001, Math.min(0.76, reveal.durationSec * 0.34));
      const timeline = gsap.timeline({ paused: true });
      timeline.fromTo(".registration.top", { opacity: 0, x: -40 }, { opacity: 1, x: 0, duration: entrance * .55, ease: "power3.out" }, reveal.startSec);
      timeline.fromTo(".title-axis", { scaleY: 0 }, { scaleY: 1, duration: entrance * .78, ease: "power2.out" }, reveal.startSec);
      timeline.fromTo(".title-kicker", { opacity: 0, x: -70 }, { opacity: 1, x: 0, duration: entrance * .7, ease: "circ.out" }, reveal.startSec + entrance * .12);
      timeline.fromTo(".title-heading", { opacity: 0, y: 110, scale: .92 }, { opacity: 1, y: 0, scale: 1, duration: entrance, ease: "expo.out" }, reveal.startSec + entrance * .18);
      timeline.fromTo(".title-subtitle", { opacity: 0, x: 70 }, { opacity: 1, x: 0, duration: entrance * .72, ease: "power4.out" }, reveal.startSec + entrance * .52);
      timeline.fromTo(".title-ordinal", { opacity: 0, scale: .72, rotation: -8 }, { opacity: 1, scale: 1, rotation: 0, duration: entrance * 1.1, ease: "power3.out" }, reveal.startSec);
      timeline.fromTo(".title-signal-fill", { scaleX: 0 }, { scaleX: 1, duration: Math.max(.001, reveal.durationSec), ease: "none" }, reveal.startSec);
      timeline.fromTo(".title-halo", { x: "16vw", y: "-12vh", scale: .7, rotation: -12 }, { x: "-18vw", y: "28vh", scale: 1.12, rotation: 8, duration: Math.max(.001, reveal.durationSec), ease: "sine.inOut" }, reveal.startSec);
      timeline.fromTo(".registration.bottom", { opacity: 0, x: 36 }, { opacity: 1, x: 0, duration: entrance * .55, ease: "power2.out" }, reveal.startSec + entrance * .64);
      window.__showtell.timeline = timeline;
    `;

const CODE_BODY = `
    <main class="scene code-scene">
      <div class="grain"></div>
      <div class="code-ghost">{ }</div>
      <div class="registration top">Repo / live bytes</div>
      <div class="registration bottom">Source / exact frame</div>
      <div class="code-rule"></div>
      <div class="safe">
        <aside class="code-rail">
          <div class="code-live"><span class="code-live-dot"></span>Source truth</div>
          <div class="code-file"></div>
          <div class="code-note"><span>RESOLVED FROM REPO</span><span>AT RENDER TIME</span></div>
        </aside>
        <section class="code-stage">
          <st-code input="source" reveal-range="reveal" max-lines="22"></st-code>
          <div class="code-scan"></div>
        </section>
      </div>
    </main>`;

const CODE_SCRIPT = `
      const st = window.__showtell;
      const reveal = st.range("reveal");
      document.querySelector(".code-file").textContent = st.props.file;
      const entrance = Math.max(0.001, Math.min(0.72, reveal.durationSec * .32));
      const timeline = gsap.timeline({ paused: true });
      timeline.fromTo(".code-live", { opacity: 0, x: -48 }, { opacity: 1, x: 0, duration: entrance * .62, ease: "power3.out" }, reveal.startSec);
      timeline.fromTo(".code-file", { opacity: 0, y: 64, scale: .95 }, { opacity: 1, y: 0, scale: 1, duration: entrance * .86, ease: "expo.out" }, reveal.startSec + entrance * .12);
      timeline.fromTo(".code-note", { opacity: 0, x: -36 }, { opacity: 1, x: 0, duration: entrance * .58, ease: "circ.out" }, reveal.startSec + entrance * .48);
      timeline.fromTo(".code-rule", { scaleY: 0 }, { scaleY: 1, duration: entrance, ease: "power2.out" }, reveal.startSec);
      timeline.fromTo(".code-stage", { opacity: 0, x: 110, y: 24, scale: .94 }, { opacity: 1, x: 0, y: 0, scale: 1, duration: entrance * 1.16, ease: "power4.out" }, reveal.startSec + entrance * .08);
      timeline.fromTo(".code-scan", { scaleX: 0 }, { scaleX: 1, duration: Math.max(.001, reveal.durationSec), ease: "none" }, reveal.startSec);
      timeline.fromTo(".code-ghost", { opacity: .04, x: "-8vw", rotation: -7 }, { opacity: .16, x: "14vw", rotation: 5, duration: Math.max(.001, reveal.durationSec), ease: "sine.inOut" }, reveal.startSec);
      timeline.fromTo(".registration", { opacity: 0 }, { opacity: 1, duration: entrance * .5, stagger: entrance * .3, ease: "power1.out" }, reveal.startSec + entrance * .18);
      window.__showtell.timeline = timeline;
    `;

const DIFF_BODY = `
    <main class="scene diff-scene">
      <div class="grain"></div>
      <div class="diff-split"></div>
      <div class="diff-symbol plus">+</div>
      <div class="diff-symbol minus">−</div>
      <div class="registration top">Before / after</div>
      <div class="registration bottom">Git / ground truth</div>
      <div class="safe">
        <header class="diff-header">
          <div class="diff-file"></div>
          <div class="diff-ref"><strong>Range</strong><span></span></div>
        </header>
        <section class="diff-stage"><st-diff input="source" reveal-range="reveal" max-lines="22"></st-diff></section>
      </div>
      <div class="diff-mode"></div>
    </main>`;

const DIFF_SCRIPT = `
      const st = window.__showtell;
      const reveal = st.range("reveal");
      document.querySelector(".diff-file").textContent = st.props.file;
      document.querySelector(".diff-ref span").textContent = st.props.ref;
      document.querySelector(".diff-mode").textContent = st.props.animation === "magic-move" ? "Motion / magic move" : "Motion / fade";
      const magic = st.props.animation === "magic-move";
      const entrance = Math.max(0.001, Math.min(0.74, reveal.durationSec * .33));
      const timeline = gsap.timeline({ paused: true });
      timeline.fromTo(".diff-file", { opacity: 0, x: -80, y: 24 }, { opacity: 1, x: 0, y: 0, duration: entrance * .82, ease: "power4.out" }, reveal.startSec);
      timeline.fromTo(".diff-ref", { opacity: 0, x: 54 }, { opacity: 1, x: 0, duration: entrance * .62, ease: "circ.out" }, reveal.startSec + entrance * .18);
      timeline.fromTo(".diff-stage", { opacity: 0, x: magic ? 100 : 0, y: magic ? 22 : 0, scale: magic ? .94 : 1 }, { opacity: 1, x: 0, y: 0, scale: 1, duration: entrance * 1.12, ease: magic ? "expo.out" : "power2.out" }, reveal.startSec + entrance * .12);
      timeline.fromTo(".diff-split", { opacity: 0, scaleY: .2, rotation: magic ? 32 : 24 }, { opacity: .68, scaleY: 1, rotation: 24, duration: entrance * .9, ease: "power3.out" }, reveal.startSec);
      timeline.fromTo(".diff-symbol.plus", { opacity: 0, x: 90, rotation: 12 }, { opacity: 1, x: 0, rotation: 0, duration: entrance * .9, ease: "back.out(1.4)" }, reveal.startSec + entrance * .22);
      timeline.fromTo(".diff-symbol.minus", { opacity: 0, x: -90, rotation: -12 }, { opacity: 1, x: 0, rotation: 0, duration: entrance * .9, ease: "back.out(1.4)" }, reveal.startSec + entrance * .3);
      timeline.fromTo(".grain", { x: "-4vw", y: "-3vh" }, { x: "5vw", y: "4vh", duration: Math.max(.001, reveal.durationSec), ease: "sine.inOut" }, reveal.startSec);
      timeline.fromTo(".registration, .diff-mode", { opacity: 0 }, { opacity: 1, duration: entrance * .5, stagger: entrance * .18, ease: "power1.out" }, reveal.startSec + entrance * .48);
      window.__showtell.timeline = timeline;
    `;

const TALKING_POINTS_BODY = `
    <main class="scene points-scene">
      <div class="grain"></div>
      <div class="points-orbit"></div>
      <div class="registration top">Signal / sequence</div>
      <div class="registration bottom">Narration / synchronized</div>
      <div class="safe">
        <header class="points-heading-wrap">
          <div class="points-kicker">What matters</div>
          <div class="points-heading"></div>
          <div class="points-count"></div>
        </header>
        <ol class="points-sequence"></ol>
        <div class="points-progress"><div class="points-progress-fill"></div></div>
      </div>
    </main>`;

const TALKING_POINTS_SCRIPT = `
      const st = window.__showtell;
      const reveal = st.range("reveal");
      const heading = document.querySelector(".points-heading");
      const sequence = document.querySelector(".points-sequence");
      heading.textContent = typeof st.props.heading === "string" ? st.props.heading : "";
      document.querySelector(".points-count").textContent = String(st.props.points.length).padStart(2, "0") + " SIGNALS";
      st.props.points.forEach((copy, index) => {
        const item = document.createElement("li");
        const number = document.createElement("span");
        const text = document.createElement("span");
        item.className = "point";
        number.className = "point-index";
        text.className = "point-copy";
        number.textContent = String(index + 1).padStart(2, "0");
        text.textContent = copy;
        item.append(number, text);
        sequence.append(item);
      });
      const entrance = Math.max(0.001, Math.min(0.68, reveal.durationSec * .28));
      const stagger = Math.max(0, Math.min(.28, reveal.durationSec * .48 / Math.max(1, st.props.points.length)));
      const timeline = gsap.timeline({ paused: true });
      timeline.fromTo(".points-kicker", { opacity: 0, x: -46 }, { opacity: 1, x: 0, duration: entrance * .62, ease: "power3.out" }, reveal.startSec);
      timeline.fromTo(".points-heading", { opacity: 0, y: 58, scale: .94 }, { opacity: 1, y: 0, scale: 1, duration: entrance * .9, ease: "expo.out" }, reveal.startSec + entrance * .12);
      timeline.fromTo(".points-count", { opacity: 0, x: -30 }, { opacity: 1, x: 0, duration: entrance * .55, ease: "circ.out" }, reveal.startSec + entrance * .4);
      timeline.fromTo(".point", { opacity: 0, x: 92, scale: .96 }, { opacity: 1, x: 0, scale: 1, duration: entrance, stagger, ease: "power4.out" }, reveal.startSec + entrance * .16);
      timeline.fromTo(".points-progress-fill", { scaleY: 0 }, { scaleY: 1, duration: Math.max(.001, reveal.durationSec), ease: "none" }, reveal.startSec);
      timeline.fromTo(".points-orbit", { x: "-12vw", y: "-8vh", rotation: -18, scale: .76 }, { x: "34vw", y: "30vh", rotation: 18, scale: 1.15, duration: Math.max(.001, reveal.durationSec), ease: "sine.inOut" }, reveal.startSec);
      timeline.fromTo(".registration", { opacity: 0 }, { opacity: 1, duration: entrance * .45, stagger: entrance * .28, ease: "power1.out" }, reveal.startSec + entrance * .2);
      window.__showtell.timeline = timeline;
    `;

const CHART_BODY = `
    <main class="scene chart-scene">
      <div class="grain"></div>
      <div class="chart-ghost">DATA</div>
      <div class="registration top">Declared / data</div>
      <div class="registration bottom">Chart / exact range</div>
      <div class="safe">
        <aside class="chart-rail">
          <div class="chart-kind"></div>
          <div class="chart-word">Motion</div>
          <div class="chart-fields"></div>
        </aside>
        <section class="chart-stage">
          <st-chart input="data" reveal-range="reveal"></st-chart>
          <div class="chart-baseline"></div>
        </section>
      </div>
    </main>`;

const CHART_SCRIPT = `
      const st = window.__showtell;
      const reveal = st.range("reveal");
      const chart = document.querySelector("st-chart");
      chart.setAttribute("type", st.props.chartType);
      chart.setAttribute("x", typeof st.props.x === "string" ? st.props.x : "");
      chart.setAttribute("y", typeof st.props.y === "string" ? st.props.y : "");
      chart.setAttribute("title", typeof st.props.title === "string" ? st.props.title : "");
      document.querySelector(".chart-kind").textContent = st.props.chartType + " / chart";
      const fields = [st.props.x, st.props.y].filter((value) => typeof value === "string" && value.length > 0);
      document.querySelector(".chart-fields").textContent = fields.length ? fields.join(" → ") : "AUTO FIELDS";
      const entrance = Math.max(0.001, Math.min(0.74, reveal.durationSec * .32));
      const timeline = gsap.timeline({ paused: true });
      timeline.fromTo(".chart-kind", { opacity: 0, x: -48 }, { opacity: 1, x: 0, duration: entrance * .58, ease: "power3.out" }, reveal.startSec);
      timeline.fromTo(".chart-word", { opacity: 0, y: 70, scale: .92 }, { opacity: 1, y: 0, scale: 1, duration: entrance * .88, ease: "expo.out" }, reveal.startSec + entrance * .12);
      timeline.fromTo(".chart-fields", { opacity: 0, x: -34 }, { opacity: 1, x: 0, duration: entrance * .54, ease: "circ.out" }, reveal.startSec + entrance * .48);
      timeline.fromTo(".chart-stage", { opacity: 0, x: 100, y: 26, scale: .94 }, { opacity: 1, x: 0, y: 0, scale: 1, duration: entrance * 1.12, ease: "power4.out" }, reveal.startSec + entrance * .08);
      timeline.fromTo(".chart-baseline", { scaleX: 0 }, { scaleX: 1, duration: Math.max(.001, reveal.durationSec), ease: "none" }, reveal.startSec);
      timeline.fromTo(".chart-ghost", { opacity: .02, x: "10vw", y: "-4vh" }, { opacity: .14, x: "-12vw", y: "8vh", duration: Math.max(.001, reveal.durationSec), ease: "sine.inOut" }, reveal.startSec);
      timeline.fromTo(".registration", { opacity: 0 }, { opacity: 1, duration: entrance * .5, stagger: entrance * .28, ease: "power1.out" }, reveal.startSec + entrance * .2);
      window.__showtell.timeline = timeline;
    `;

function documentSource(manifest: SimpleWebManifest, css: string, body: string, script: string): string {
  return `<!doctype html>
<html lang="en">
  <head>
    <meta charset="utf-8" />
    <script type="application/showtell+json">${JSON.stringify(manifest)}</script>
    <style>${BASE_CSS}${css}</style>
  </head>
  <body>${body}
    <script>${script}</script>
  </body>
</html>
`;
}

/** The exact manifest contract embedded in the generated document for a simple scene. */
export function simpleWebManifest(scene: SimpleWebScene): SimpleWebManifest {
  return MANIFESTS[scene.kind];
}

/** The exact manifest-valid props passed to the generated document by the lowerer. */
export function simpleWebProps(scene: SimpleWebScene): Record<string, unknown> {
  switch (scene.kind) {
    case "title":
      return {
        heading: scene.content.heading,
        ...(scene.content.subtitle === undefined ? {} : { subtitle: scene.content.subtitle }),
      };
    case "code":
      return { file: scene.content.file };
    case "diff":
      return {
        file: scene.content.file,
        ref: scene.content.ref,
        animation: scene.content.animation,
      };
    case "talking-points":
      return {
        ...(scene.content.heading === undefined ? {} : { heading: scene.content.heading }),
        points: [...scene.content.points],
      };
    case "chart":
      return {
        chartType: scene.content.chartType,
        ...(scene.content.title === undefined ? {} : { title: scene.content.title }),
        ...(scene.content.x === undefined ? {} : { x: scene.content.x }),
        ...(scene.content.y === undefined ? {} : { y: scene.content.y }),
      };
  }
}

/** Generate one deterministic, responsive browser HyperFrame for a declarative simple scene. */
export function simpleWebDocument(scene: SimpleWebScene): string {
  switch (scene.kind) {
    case "title":
      return documentSource(simpleWebManifest(scene), TITLE_CSS, TITLE_BODY, TITLE_SCRIPT);
    case "code":
      return documentSource(simpleWebManifest(scene), CODE_CSS, CODE_BODY, CODE_SCRIPT);
    case "diff":
      return documentSource(simpleWebManifest(scene), DIFF_CSS, DIFF_BODY, DIFF_SCRIPT);
    case "talking-points":
      return documentSource(simpleWebManifest(scene), TALKING_POINTS_CSS, TALKING_POINTS_BODY, TALKING_POINTS_SCRIPT);
    case "chart":
      return documentSource(simpleWebManifest(scene), CHART_CSS, CHART_BODY, CHART_SCRIPT);
  }
}
