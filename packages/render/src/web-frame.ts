import { createHash } from "node:crypto";
import { existsSync, readFileSync } from "node:fs";
import { dirname, join, resolve, sep } from "node:path";
import { bundleWebFile, type AspectRatio, type BundleScene } from "@showtell/core";
import { captionSafeArea, dimsFor, presenterSafeArea } from "@showtell/compose";
import { chromium, type Browser, type BrowserContext, type Page } from "playwright";
import gsapSource from "gsap/dist/gsap.min.js" with { type: "text" };
import inter400 from "@fontsource/inter/files/inter-latin-400-normal.woff2" with { type: "file" };
import inter500 from "@fontsource/inter/files/inter-latin-500-normal.woff2" with { type: "file" };
import inter600 from "@fontsource/inter/files/inter-latin-600-normal.woff2" with { type: "file" };
import inter700 from "@fontsource/inter/files/inter-latin-700-normal.woff2" with { type: "file" };
import jetbrainsMono from "@fontsource/jetbrains-mono/files/jetbrains-mono-latin-400-normal.woff2" with { type: "file" };
import leagueGothic from "@fontsource/league-gothic/files/league-gothic-latin-400-normal.woff2" with { type: "file" };
import spaceMono from "@fontsource/space-mono/files/space-mono-latin-400-normal.woff2" with { type: "file" };
import type { BundleCompileResult, CompiledBundleScene, ExactBundleFrame } from "./bundle.ts";
import { webComponentsSource } from "./web-components.ts";
import { resolveVisualInputs } from "./runtime-inputs.ts";
import { webRuntimeIdentity } from "./web-authoring.ts";
import { headlessShellExecutable } from "./chromium-path.ts";

export interface CapturedWebFrame {
  png: Buffer;
  width: number;
  height: number;
  sha256: string;
  resolvedRefs: { file: string; text: string }[];
}

interface PageEntry {
  page: Page;
  context: BrowserContext;
  blockedRequests: string[];
  pageErrors: string[];
}

const BROWSER_CLOSE_TIMEOUT_MS = 2_000;
// Chromium startup and the first renderer evaluation can briefly contend with
// other browser-backed tests on CI. Keep the watchdog bounded, but leave enough
// headroom for that cold-start path before treating the browser as wedged.
const BROWSER_OPERATION_TIMEOUT_MS = 20_000;
const BROWSER_SCREENSHOT_TIMEOUT_MS = 3_000;
const BROWSER_PROCESS_SETTLE_MS = 1_500;
const BROWSER_LAUNCH_ATTEMPTS = 3;

// Bun/Playwright allocates a fresh pipe/socket transport for every Chromium
// process and can transiently lose rapid concurrent handshakes. Keep launches
// ordered inside one Showtell process; this is lifecycle hardening, not dead
// serialization that should be removed as an optimization.
let browserLaunchTail: Promise<void> = Promise.resolve();

class BrowserOperationError extends Error {
  constructor(operation: string, cause: unknown) {
    const detail = cause instanceof Error ? cause.message : String(cause);
    super(`${operation} failed: ${detail}`, { cause });
    this.name = "BrowserOperationError";
  }
}

class PinnedBrowserVersionError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "PinnedBrowserVersionError";
  }
}

function serializeBrowserLaunch<T>(launch: () => Promise<T>): Promise<T> {
  const result = browserLaunchTail.then(launch);
  browserLaunchTail = result.then(
    () => undefined,
    () => undefined,
  );
  return result;
}

async function settleBrowserProcess(): Promise<void> {
  await new Promise<void>((resolveDelay) => setTimeout(resolveDelay, BROWSER_PROCESS_SETTLE_MS));
}

async function browserOperation<T>(operation: string, promise: Promise<T>): Promise<T> {
  let timeout: ReturnType<typeof setTimeout> | undefined;
  try {
    return await Promise.race([
      promise,
      new Promise<never>((_, reject) => {
        timeout = setTimeout(
          () => reject(new Error(`did not complete within ${BROWSER_OPERATION_TIMEOUT_MS}ms`)),
          BROWSER_OPERATION_TIMEOUT_MS,
        );
      }),
    ]);
  } catch (error) {
    if (error instanceof BrowserOperationError) throw error;
    throw new BrowserOperationError(operation, error);
  } finally {
    if (timeout) clearTimeout(timeout);
  }
}

async function teardownBounded(operation: Promise<unknown>): Promise<void> {
  let timeout: ReturnType<typeof setTimeout> | undefined;
  try {
    await Promise.race([
      operation.catch(() => undefined),
      new Promise<void>((resolveTimeout) => {
        timeout = setTimeout(resolveTimeout, BROWSER_CLOSE_TIMEOUT_MS);
      }),
    ]);
  } finally {
    if (timeout) clearTimeout(timeout);
  }
}

async function closeBrowser(browser: Browser): Promise<void> {
  const contexts = browser.contexts();
  await Promise.all(contexts.flatMap((context) => context.pages().map((page) => teardownBounded(page.close()))));
  await Promise.all(contexts.map((context) => teardownBounded(context.close())));
  await teardownBounded(browser.close());
  await settleBrowserProcess();
}

function browserFromBundle(browserDir: string): string | undefined {
  const manifestPath = join(browserDir, "runtime.json");
  if (!existsSync(manifestPath)) return undefined;
  const manifest = JSON.parse(readFileSync(manifestPath, "utf-8")) as {
    chromiumRevision?: string;
    browserVersion?: string;
    executable?: string;
    target?: string;
  };
  if (
    manifest.chromiumRevision !== webRuntimeIdentity.chromiumRevision ||
    manifest.browserVersion !== webRuntimeIdentity.browserVersion
  ) {
    throw new Error(
      `Bundled Chromium identity mismatch at ${manifestPath}; expected revision ${webRuntimeIdentity.chromiumRevision}.`,
    );
  }
  const hostTarget = `${process.platform}-${process.arch}`;
  if (manifest.target && manifest.target !== hostTarget) {
    throw new Error(
      `Bundled Chromium at ${manifestPath} is built for ${manifest.target}, not ${hostTarget}. Reinstall the Showtell platform package for this machine.`,
    );
  }
  if (!manifest.executable) throw new Error(`Bundled Chromium manifest has no executable path: ${manifestPath}`);
  const root = resolve(browserDir);
  const executable = resolve(root, manifest.executable);
  if (executable !== root && !executable.startsWith(`${root}${sep}`)) {
    throw new Error(`Bundled Chromium executable escapes its browser directory: ${manifest.executable}`);
  }
  if (!existsSync(executable)) throw new Error(`Bundled Chromium executable is missing: ${executable}`);
  return executable;
}

function resolveChromiumExecutable(): string | undefined {
  const override = process.env.SHOWTELL_CHROMIUM_PATH;
  if (override) {
    const executable = resolve(override);
    if (!existsSync(executable)) throw new Error(`SHOWTELL_CHROMIUM_PATH does not exist: ${executable}`);
    return executable;
  }

  const binaryDir = dirname(process.execPath);
  for (const browserDir of [join(binaryDir, "browser"), join(binaryDir, "..", "browser")]) {
    const executable = browserFromBundle(browserDir);
    if (executable) return executable;
  }

  const developmentExecutable = headlessShellExecutable(chromium.executablePath(), webRuntimeIdentity.chromiumRevision);
  return existsSync(developmentExecutable) ? developmentExecutable : undefined;
}

/** Reject an override or damaged package whose executable is not the compiled runtime. */
export function assertPinnedBrowserVersion(actual: string): void {
  const version = actual.match(/\d+\.\d+\.\d+\.\d+/)?.[0];
  if (!version || !version.startsWith(`${webRuntimeIdentity.browserVersion}.`)) {
    throw new PinnedBrowserVersionError(
      `Chromium runtime version mismatch: expected ${webRuntimeIdentity.browserVersion}.x, received ${actual || "unknown"}.`,
    );
  }
}

async function launchBrowser(): Promise<Browser> {
  const executablePath = resolveChromiumExecutable();
  if (!executablePath) {
    throw new Error(
      "Showtell could not launch its pinned Chromium runtime: the pinned Chromium executable is not installed or bundled. " +
        "Reinstall the Showtell platform package, or run `bunx playwright install chromium` when developing from source.",
    );
  }

  return serializeBrowserLaunch(async () => {
    let lastError: unknown;
    for (let attempt = 0; attempt < BROWSER_LAUNCH_ATTEMPTS; attempt++) {
      try {
        const browser = await chromium.launch({
          headless: true,
          executablePath,
          timeout: BROWSER_OPERATION_TIMEOUT_MS,
          args: [
            `--force-color-profile=${webRuntimeIdentity.colorProfile}`,
            "--font-render-hinting=none",
            "--disable-lcd-text",
            "--hide-scrollbars",
            // GPU rasterization varies across (virtualized) GPUs and runs;
            // byte-stable frames require the software raster path.
            "--disable-gpu",
          ],
        });
        try {
          assertPinnedBrowserVersion(browser.version());
        } catch (error) {
          await closeBrowser(browser);
          throw error;
        }
        return browser;
      } catch (error) {
        if (error instanceof PinnedBrowserVersionError) throw error;
        lastError = error;
        if (attempt < BROWSER_LAUNCH_ATTEMPTS - 1) await settleBrowserProcess();
      }
    }
    const detail = lastError instanceof Error ? lastError.message : String(lastError);
    throw new Error(
      `Showtell could not launch its pinned Chromium runtime after ${BROWSER_LAUNCH_ATTEMPTS} attempts: ${detail}. ` +
        "Reinstall the Showtell platform package, or run `bunx playwright install chromium` when developing from source.",
      { cause: lastError },
    );
  });
}

/** Launch the exact configured runtime and prove it can capture one frame. */
export async function checkWebRuntime(): Promise<{
  ok: true;
  identity: typeof webRuntimeIdentity;
  executablePath: string;
  captureBytes: number;
}> {
  const executablePath = resolveChromiumExecutable();
  if (!executablePath) throw new Error("The pinned Chromium executable is not installed or bundled.");
  const browser = await launchBrowser();
  let context: BrowserContext | undefined;
  try {
    context = await browserOperation(
      "Chromium runtime context creation",
      browser.newContext({
        viewport: { width: 320, height: 180 },
        deviceScaleFactor: webRuntimeIdentity.deviceScaleFactor,
        locale: webRuntimeIdentity.locale,
        timezoneId: webRuntimeIdentity.timezone,
      }),
    );
    const page = await browserOperation("Chromium runtime page creation", context.newPage());
    await page.setContent("<style>html,body{margin:0;background:#0b0c14}</style>", {
      timeout: BROWSER_OPERATION_TIMEOUT_MS,
    });
    const png = await page.screenshot({ type: "png", timeout: BROWSER_OPERATION_TIMEOUT_MS });
    return { ok: true, identity: webRuntimeIdentity, executablePath, captureBytes: png.length };
  } finally {
    if (context) await teardownBounded(context.close());
    await closeBrowser(browser);
  }
}

function sha256(data: string | Buffer): string {
  return createHash("sha256").update(data).digest("hex");
}

function safeJson(value: unknown): string {
  return JSON.stringify(value)
    .replaceAll("<", "\\u003c")
    .replaceAll(">", "\\u003e")
    .replaceAll("&", "\\u0026")
    .replaceAll("\u2028", "\\u2028")
    .replaceAll("\u2029", "\\u2029");
}

function fontData(path: string): string {
  return readFileSync(path).toString("base64");
}

const RUNTIME_CSS = `
@font-face{font-family:Inter;src:url(data:font/woff2;base64,${fontData(inter400)}) format("woff2");font-weight:400;font-style:normal;font-display:block}
@font-face{font-family:Inter;src:url(data:font/woff2;base64,${fontData(inter500)}) format("woff2");font-weight:500;font-style:normal;font-display:block}
@font-face{font-family:Inter;src:url(data:font/woff2;base64,${fontData(inter600)}) format("woff2");font-weight:600;font-style:normal;font-display:block}
@font-face{font-family:Inter;src:url(data:font/woff2;base64,${fontData(inter700)}) format("woff2");font-weight:700;font-style:normal;font-display:block}
@font-face{font-family:"JetBrains Mono";src:url(data:font/woff2;base64,${fontData(jetbrainsMono)}) format("woff2");font-weight:400;font-style:normal;font-display:block}
@font-face{font-family:"League Gothic";src:url(data:font/woff2;base64,${fontData(leagueGothic)}) format("woff2");font-weight:400;font-style:normal;font-display:block}
@font-face{font-family:"Space Mono";src:url(data:font/woff2;base64,${fontData(spaceMono)}) format("woff2");font-weight:400;font-style:normal;font-display:block}
:root{color-scheme:dark;--st-safe-top:0px;--st-safe-right:0px;--st-safe-bottom:0px;--st-safe-left:0px}
html,body{width:100%;height:100%;margin:0;overflow:hidden}
*,*::before,*::after{box-sizing:border-box;animation-play-state:paused!important;caret-color:transparent!important}
`;

function browserBootstrap(initial: unknown): string {
  return `
(()=>{
  "use strict";
  const initial=${safeJson(initial)};
  const clamp=(v)=>Math.max(0,Math.min(1,v));
  const hash=(text)=>{let h=2166136261;for(let i=0;i<text.length;i++){h^=text.charCodeAt(i);h=Math.imul(h,16777619)}return(h>>>0)/4294967295};
  const st={
    ...initial,
    timeline:null,
    __blockedRequests:[],
    __blockedApis:[],
    __ambientAnimationCount:0,
    time:{absoluteMs:initial.scene.startMs,sceneMs:0,frame:0},
    line:{index:0,id:initial.scene.lines[0]?.id,count:initial.scene.lines.length,active:true,progress:0},
    range(name){const value=this.inputs[name];if(!value||value.kind!=="range")throw new Error('Unknown range "'+name+'".');return value},
    random(key){return hash(initial.seed+":"+String(key))},
    __stopAmbientMotion(){
      const animations=document.getAnimations();
      this.__ambientAnimationCount+=animations.length;
      for(const animation of animations)animation.cancel();
      for(const svg of document.querySelectorAll("svg")){
        if(typeof svg.setCurrentTime==="function")svg.setCurrentTime(0);
        if(typeof svg.pauseAnimations==="function")svg.pauseAnimations();
      }
    },
    __setFrame(frame){
      this.time={absoluteMs:frame.timeMs,sceneMs:frame.sceneMs,frame:frame.frame};
      this.scene.progress=frame.sceneProgress;
      this.scene.lineIndex=frame.lineIndex;
      this.scene.lineId=frame.lineId;
      this.line={index:frame.lineIndex,id:frame.lineId,count:this.scene.lines.length,active:frame.lineActive,progress:frame.lineProgress};
      for(const value of Object.values(this.inputs)){
        if(value&&value.kind==="range"){
          value.active=frame.timeMs>=value.startMs&&frame.timeMs<=value.endMs;
          value.progress=value.durationMs>0?clamp((frame.timeMs-value.startMs)/value.durationMs):1;
        }
      }
      document.dispatchEvent(new CustomEvent("showtell:frame",{detail:frame}));
      this.__stopAmbientMotion();
    }
  };
  Object.defineProperty(window,"__showtell",{value:st,writable:false,configurable:false});
  window.addEventListener("securitypolicyviolation",event=>st.__blockedRequests.push(event.blockedURI||event.violatedDirective));
  const style=document.documentElement.style;
  for(const [name,value] of Object.entries(initial.cssVariables))style.setProperty(name,String(value));

  const native={
    mathRandom:Math.random,
    setTimeout:window.setTimeout,
    setInterval:window.setInterval,
    requestAnimationFrame:window.requestAnimationFrame,
    cancelAnimationFrame:window.cancelAnimationFrame,
    fetch:window.fetch,
    XMLHttpRequest:window.XMLHttpRequest,
    WebSocket:window.WebSocket,
    EventSource:window.EventSource,
    Worker:window.Worker,
    SharedWorker:window.SharedWorker,
    Date:window.Date
  };
  let guardsInstalled=false;
  const recordBlocked=(name)=>st.__blockedApis.push(name);
  class ShowtellDate extends native.Date{
    constructor(...args){super(...(args.length?args:[st.time.absoluteMs]))}
    static now(){return st.time.absoluteMs}
  }
  st.__installRuntimeGuards=()=>{
    if(guardsInstalled)return;
    guardsInstalled=true;
    Math.random=()=>{recordBlocked("Math.random");return 0};
    window.setTimeout=()=>{recordBlocked("setTimeout");return 0};
    window.setInterval=()=>{recordBlocked("setInterval");return 0};
    window.requestAnimationFrame=()=>0;
    window.cancelAnimationFrame=()=>{};
    window.fetch=()=>{recordBlocked("fetch");return Promise.resolve(new Response(null,{status:204}))};
    window.XMLHttpRequest=class{constructor(){recordBlocked("XMLHttpRequest")}abort(){}open(){}send(){}setRequestHeader(){}};
    window.WebSocket=class{constructor(){recordBlocked("WebSocket")}close(){}send(){}};
    window.EventSource=class{constructor(){recordBlocked("EventSource")}close(){}};
    window.Worker=class{constructor(){recordBlocked("Worker")}postMessage(){}terminate(){}};
    window.SharedWorker=class{constructor(){recordBlocked("SharedWorker")}postMessage(){}terminate(){}};
    Object.defineProperty(window.crypto,"getRandomValues",{value:(array)=>{recordBlocked("crypto.getRandomValues");array.fill(0);return array},writable:false,configurable:true});
    Object.defineProperty(window.crypto,"randomUUID",{value:()=>{recordBlocked("crypto.randomUUID");return "00000000-0000-4000-8000-000000000000"},writable:false,configurable:true});
    Object.defineProperty(window.performance,"now",{value:()=>st.time.absoluteMs,writable:false,configurable:true});
    window.Date=ShowtellDate;
  };
  st.__restoreRuntimeGuards=()=>{
    if(!guardsInstalled)return;
    guardsInstalled=false;
    Math.random=native.mathRandom;
    window.setTimeout=native.setTimeout;
    window.setInterval=native.setInterval;
    window.requestAnimationFrame=native.requestAnimationFrame;
    window.cancelAnimationFrame=native.cancelAnimationFrame;
    window.fetch=native.fetch;
    window.XMLHttpRequest=native.XMLHttpRequest;
    window.WebSocket=native.WebSocket;
    window.EventSource=native.EventSource;
    window.Worker=native.Worker;
    window.SharedWorker=native.SharedWorker;
    delete window.crypto.getRandomValues;
    delete window.crypto.randomUUID;
    delete window.performance.now;
    window.Date=native.Date;
  };

${webComponentsSource}
  st.__installRuntimeGuards();
  st.__stopAmbientMotion();
  if(window.gsap?.ticker)window.gsap.ticker.sleep();
})();`;
}

function cssVariables(runtime: BundleCompileResult, aspectRatio: AspectRatio): Record<string, string> {
  const theme = runtime.plan.meta.resolvedTheme;
  const dims = dimsFor(aspectRatio);
  const presenter = runtime.presenter
    ? presenterSafeArea(runtime.presenter.position, runtime.presenter.size, dims)
    : { top: 0, right: 0, bottom: 0, left: 0 };
  const captions = burnInCaptions(runtime) ? captionSafeArea(dims) : { top: 0, right: 0, bottom: 0, left: 0 };
  const variables: Record<string, string> = {
    "--st-bg": theme.colors.bg,
    "--st-fg": theme.colors.fg,
    "--st-subtle": theme.colors.subtle,
    "--st-accent": theme.colors.accent,
    "--st-accent-2": theme.colors.accent2 ?? theme.colors.accent,
    "--st-success": theme.colors.success,
    "--st-warning": theme.colors.warning,
    "--st-surface": theme.colors.surface,
    "--st-border": theme.colors.border,
    "--st-caption-bg": theme.colors.captionBg,
    "--st-caption-fg": theme.colors.captionFg,
    "--st-font-display": theme.typography.display,
    "--st-font-body": theme.typography.body,
    "--st-font-mono": theme.typography.mono,
    "--st-safe-top": `${presenter.top}px`,
    "--st-safe-right": `${presenter.right}px`,
    "--st-safe-bottom": `${Math.max(captions.bottom, presenter.bottom)}px`,
    "--st-safe-left": `${presenter.left}px`,
  };
  theme.chart.slice(0, 10).forEach((color, index) => {
    variables[`--st-chart-${index + 1}`] = color;
  });
  return variables;
}

function burnInCaptions(runtime: BundleCompileResult): boolean {
  const mode = runtime.plan.audio.captions.mode;
  return mode === "burn-in" || mode === "sidecar-and-burn-in";
}

export function decorateHtml(source: string, initial: unknown): string {
  const injection = `<meta http-equiv="Content-Security-Policy" content="default-src 'none'; img-src data:; font-src data:; style-src 'unsafe-inline'; script-src 'unsafe-inline'"><style>${RUNTIME_CSS}</style><script>${gsapSource.replaceAll("</script", "<\\/script")}</script><script>${browserBootstrap(initial).replaceAll("</script", "<\\/script")}</script>`;
  // Inject inside <head> when present; otherwise stay AFTER the doctype/<html> —
  // content before <!doctype> would force the whole document into quirks mode.
  const anchor =
    /<head(?:\s[^>]*)?>/i.exec(source) ?? /<html(?:\s[^>]*)?>/i.exec(source) ?? /<!doctype[^>]*>/i.exec(source);
  const decorated =
    !anchor || anchor.index === undefined
      ? `${injection}${source}`
      : `${source.slice(0, anchor.index + anchor[0].length)}${injection}${source.slice(anchor.index + anchor[0].length)}`;
  const cleanup = `<script>window.__showtell.__stopAmbientMotion();window.__showtell.__restoreRuntimeGuards()</script>`;
  const bodyClose = /<\/body\s*>/i.exec(decorated);
  if (!bodyClose || bodyClose.index === undefined) return `${decorated}${cleanup}`;
  return `${decorated.slice(0, bodyClose.index)}${cleanup}${decorated.slice(bodyClose.index)}`;
}

async function waitForDocumentFonts(page: Page, visualSrc: string): Promise<void> {
  for (let attempt = 0; attempt < 200; attempt++) {
    const status = await browserOperation(
      `Font readiness check for ${visualSrc}`,
      page.evaluate(() => (globalThis as unknown as { document: { fonts: { status: string } } }).document.fonts.status),
    );
    if (status === "loaded") return;
    await new Promise<void>((resolveDelay) => setTimeout(resolveDelay, 25));
  }
  throw new Error(`Web visual ${visualSrc} did not finish loading its renderer-provided fonts within 5 seconds.`);
}

function assertDeterministicPolicy(
  visualSrc: string,
  policy: { ambientAnimationCount: number; blockedApis: string[] },
): void {
  const violations: string[] = [];
  if (policy.blockedApis.length > 0) {
    violations.push(`${[...new Set(policy.blockedApis)].join(", ")} is disabled`);
  }
  if (policy.ambientAnimationCount > 0) violations.push("Web Animations API is disabled");
  if (violations.length === 0) return;
  throw new Error(
    `Web visual ${visualSrc}: ${violations.join("; ")} in deterministic Showtell renders. ` +
      "Use declared inputs, window.__showtell helpers, and window.__showtell.timeline instead.",
  );
}

function initialContext(
  runtime: BundleCompileResult,
  scene: BundleScene,
  compiledScene: CompiledBundleScene,
  aspectRatio: AspectRatio,
) {
  if (scene.visual.kind !== "web" || compiledScene.program.kind !== "web") {
    throw new Error("Scene visual is not compiled web HTML.");
  }
  const dims = dimsFor(aspectRatio);
  const resolved = resolveVisualInputs(runtime, scene, compiledScene);
  const presenter = runtime.presenter
    ? presenterSafeArea(runtime.presenter.position, runtime.presenter.size, dims)
    : { top: 0, right: 0, bottom: 0, left: 0, position: undefined };
  const captions = burnInCaptions(runtime) ? captionSafeArea(dims) : { top: 0, right: 0, bottom: 0, left: 0 };
  const inputs = Object.fromEntries(
    Object.entries(resolved.inputs).map(([name, value]) => [
      name,
      value.kind === "range"
        ? {
            ...value,
            startSec: (value.startMs - compiledScene.startMs) / 1000,
            endSec: (value.endMs - compiledScene.startMs) / 1000,
            durationSec: value.durationMs / 1000,
            active: false,
            progress: 0,
          }
        : value,
    ]),
  );
  return {
    props: scene.visual.props,
    inputs,
    theme: runtime.plan.meta.resolvedTheme,
    viewport: { width: dims.width, height: dims.height, aspectRatio, fps: runtime.spec.meta.fps },
    scene: {
      id: compiledScene.id,
      index: compiledScene.index,
      startMs: compiledScene.startMs,
      endMs: compiledScene.endMs,
      durationMs: compiledScene.durationMs,
      progress: 0,
      lineIndex: 0,
      lineId: compiledScene.narration.lines[0]?.id,
      lines: compiledScene.narration.lines.map((line) => ({
        id: line.id,
        text: line.text,
        startMs: line.startMs,
        endMs: line.endMs,
        durationMs: line.durationMs,
        startSec: (line.startMs - compiledScene.startMs) / 1000,
        endSec: (line.endMs - compiledScene.startMs) / 1000,
        durationSec: line.durationMs / 1000,
      })),
    },
    safeArea: {
      top: presenter.top,
      right: presenter.right,
      bottom: Math.max(captions.bottom, presenter.bottom),
      left: presenter.left,
    },
    captions: { safeArea: captions },
    presenter: runtime.presenter
      ? { enabled: true, position: presenter.position, size: runtime.presenter.size, safeArea: presenter }
      : { enabled: false },
    cssVariables: cssVariables(runtime, aspectRatio),
    seed: `${compiledScene.program.sourceSha256}:${compiledScene.id}`,
  };
}

export class WebFrameRenderer {
  private browser?: Browser;
  private browserPromise?: Promise<Browser>;
  private closePromise?: Promise<void>;
  private readonly pages = new Map<string, PageEntry>();

  constructor(private readonly runtime: BundleCompileResult) {}

  private async ensureBrowser(): Promise<Browser> {
    if (this.browser?.isConnected()) return this.browser;
    const pending = this.browserPromise ?? launchBrowser();
    this.browserPromise = pending;
    try {
      const browser = await pending;
      this.browser = browser;
      return browser;
    } finally {
      if (this.browserPromise === pending) this.browserPromise = undefined;
    }
  }

  private async pageFor(
    scene: BundleScene,
    compiledScene: CompiledBundleScene,
    aspectRatio: AspectRatio,
  ): Promise<PageEntry> {
    if (scene.visual.kind !== "web" || compiledScene.program.kind !== "web") {
      throw new Error("Scene is not a compiled web visual.");
    }
    const key = `${compiledScene.id}:${aspectRatio}:${compiledScene.program.sourceSha256}:${compiledScene.program.propsSha256}`;
    const existing = this.pages.get(key);
    if (existing) return existing;

    const sourcePath = bundleWebFile(this.runtime.bundleDir, scene.visual.src).path;
    const source = readFileSync(sourcePath, "utf-8");
    if (sha256(source) !== compiledScene.program.sourceSha256) {
      throw new Error(`Web visual ${scene.visual.src} changed after compile. Re-run bundle compile before rendering.`);
    }

    // Resolve and hash-check all live inputs before leasing Chromium. A stale
    // plan should fail without creating a page or entering browser teardown.
    const initial = initialContext(this.runtime, scene, compiledScene, aspectRatio);
    const dims = dimsFor(aspectRatio);
    const browser = await this.ensureBrowser();
    let context: BrowserContext | undefined;
    let page: Page | undefined;
    try {
      context = await browserOperation(
        `Context creation for ${scene.visual.src}`,
        browser.newContext({
          viewport: { width: dims.width, height: dims.height },
          deviceScaleFactor: webRuntimeIdentity.deviceScaleFactor,
          colorScheme: webRuntimeIdentity.colorScheme,
          reducedMotion: webRuntimeIdentity.reducedMotion,
          locale: webRuntimeIdentity.locale,
          timezoneId: webRuntimeIdentity.timezone,
        }),
      );
      page = await browserOperation(`Page creation for ${scene.visual.src}`, context.newPage());
      const entry: PageEntry = { page, context, blockedRequests: [], pageErrors: [] };
      page.on("pageerror", (error) => entry.pageErrors.push(error.message));
      await page.route("**/*", async (route) => {
        entry.blockedRequests.push(route.request().url());
        await route.abort("blockedbyclient");
      });
      await browserOperation(
        `Document load for ${scene.visual.src}`,
        page.setContent(decorateHtml(source, initial), {
          waitUntil: "load",
          timeout: BROWSER_OPERATION_TIMEOUT_MS,
        }),
      );
      const deterministicPolicy = await browserOperation(
        `Initial policy check for ${scene.visual.src}`,
        page.evaluate(() => {
          const root = globalThis as unknown as {
            __showtell: { __ambientAnimationCount: number; __blockedApis: string[]; __stopAmbientMotion(): void };
            gsap?: { ticker?: { sleep(): void } };
          };
          root.gsap?.ticker?.sleep();
          root.__showtell.__stopAmbientMotion();
          return {
            ambientAnimationCount: root.__showtell.__ambientAnimationCount,
            blockedApis: root.__showtell.__blockedApis,
          };
        }),
      );
      assertDeterministicPolicy(scene.visual.src, deterministicPolicy);
      await waitForDocumentFonts(page, scene.visual.src);
      const timelineProblem = await browserOperation(
        `Timeline inspection for ${scene.visual.src}`,
        page.evaluate(() => {
          const timeline = (
            globalThis as unknown as {
              __showtell: { timeline?: { pause?: unknown; seek?: unknown } };
            }
          ).__showtell.timeline;
          if (!timeline) return "window.__showtell.timeline was not assigned";
          if (typeof timeline.pause !== "function" || typeof timeline.seek !== "function") {
            return "window.__showtell.timeline must expose pause() and seek()";
          }
          return undefined;
        }),
      );
      const policyBlocks = await browserOperation(
        `Network policy check for ${scene.visual.src}`,
        page.evaluate(
          () => (globalThis as unknown as { __showtell: { __blockedRequests: string[] } }).__showtell.__blockedRequests,
        ),
      );
      entry.blockedRequests.push(...policyBlocks);
      if (entry.blockedRequests.length > 0) {
        throw new Error(
          `Web visual ${scene.visual.src} attempted blocked network access: ${entry.blockedRequests.slice(0, 3).join(", ")}`,
        );
      }
      if (entry.pageErrors.length > 0) {
        throw new Error(`Web visual ${scene.visual.src} failed during initialization: ${entry.pageErrors[0]}`);
      }
      if (timelineProblem) {
        throw new Error(
          `Web visual ${scene.visual.src} has no seekable paused GSAP timeline: ${timelineProblem}. ` +
            "Assign gsap.timeline({ paused: true }) to window.__showtell.timeline.",
        );
      }
      this.pages.set(key, entry);
      return entry;
    } catch (error) {
      await this.close();
      throw error;
    }
  }

  async capture(
    scene: BundleScene,
    compiledScene: CompiledBundleScene,
    aspectRatio: AspectRatio,
    exact: ExactBundleFrame,
  ): Promise<CapturedWebFrame> {
    return this.captureAttempt(scene, compiledScene, aspectRatio, exact, true);
  }

  private async captureAttempt(
    scene: BundleScene,
    compiledScene: CompiledBundleScene,
    aspectRatio: AspectRatio,
    exact: ExactBundleFrame,
    mayRetryBrowser: boolean,
  ): Promise<CapturedWebFrame> {
    try {
      return await this.captureFrame(scene, compiledScene, aspectRatio, exact);
    } catch (error) {
      if (error instanceof BrowserOperationError) {
        await this.close();
        if (mayRetryBrowser) return this.captureAttempt(scene, compiledScene, aspectRatio, exact, false);
      }
      throw error;
    }
  }

  private async captureFrame(
    scene: BundleScene,
    compiledScene: CompiledBundleScene,
    aspectRatio: AspectRatio,
    exact: ExactBundleFrame,
  ): Promise<CapturedWebFrame> {
    const entry = await this.pageFor(scene, compiledScene, aspectRatio);
    const line = compiledScene.narration.lines[exact.lineIndex]!;
    const deterministicPolicy = await browserOperation(
      `Frame seek for ${compiledScene.id}`,
      entry.page.evaluate(
        (frame) => {
          const root = globalThis as unknown as {
            __showtell: {
              __ambientAnimationCount: number;
              __blockedApis: string[];
              __installRuntimeGuards(): void;
              __restoreRuntimeGuards(): void;
              __stopAmbientMotion(): void;
              timeline?: { pause(): unknown; seek(seconds: number, suppressEvents?: boolean): unknown };
              __setFrame(value: typeof frame): void;
            };
            gsap?: { ticker?: { sleep(): void } };
          };
          root.__showtell.__installRuntimeGuards();
          try {
            root.__showtell.__setFrame(frame);
            const timeline = root.__showtell.timeline!;
            timeline.pause();
            timeline.seek(frame.sceneMs / 1000, false);
            root.gsap?.ticker?.sleep();
          } finally {
            root.__showtell.__stopAmbientMotion();
            root.__showtell.__restoreRuntimeGuards();
          }
          return {
            ambientAnimationCount: root.__showtell.__ambientAnimationCount,
            blockedApis: root.__showtell.__blockedApis,
          };
        },
        {
          timeMs: exact.timeMs,
          sceneMs: exact.timeMs - compiledScene.startMs,
          frame: exact.frame,
          sceneProgress: exact.sceneProgress,
          lineIndex: exact.lineIndex,
          lineId: exact.lineId,
          lineActive: exact.lineActive,
          lineProgress: line.durationMs > 0 ? Math.max(0, Math.min(1, exact.lineMs / line.durationMs)) : 1,
        },
      ),
    );
    assertDeterministicPolicy(scene.visual.kind === "web" ? scene.visual.src : compiledScene.id, deterministicPolicy);
    if (entry.blockedRequests.length > 0) {
      throw new Error(`Web visual attempted blocked network access: ${entry.blockedRequests[0]}`);
    }
    if (entry.pageErrors.length > 0)
      throw new Error(`Web visual failed at ${Math.round(exact.timeMs)}ms: ${entry.pageErrors[0]}`);
    const png = await browserOperation(
      `Screenshot for ${compiledScene.id}`,
      entry.page.screenshot({
        type: "png",
        fullPage: false,
        scale: "css",
        timeout: BROWSER_SCREENSHOT_TIMEOUT_MS,
      }),
    );
    // Exceptions inside `showtell:frame` handlers surface asynchronously via
    // `pageerror`; re-check after the screenshot so the failure is attributed
    // to this frame's timestamp instead of the next captured frame (or never).
    if (entry.pageErrors.length > 0)
      throw new Error(`Web visual failed at ${Math.round(exact.timeMs)}ms: ${entry.pageErrors[0]}`);
    const dims = dimsFor(aspectRatio);
    return {
      png,
      width: dims.width,
      height: dims.height,
      sha256: sha256(png),
      resolvedRefs: resolveVisualInputs(this.runtime, scene, compiledScene).resolvedRefs,
    };
  }

  async close(): Promise<void> {
    if (this.closePromise) return this.closePromise;
    const closing = this.closeOwnedResources();
    this.closePromise = closing;
    try {
      await closing;
    } finally {
      if (this.closePromise === closing) this.closePromise = undefined;
    }
  }

  private async closeOwnedResources(): Promise<void> {
    const pendingBrowser = this.browserPromise;
    this.browserPromise = undefined;
    const browser = this.browser ?? (await pendingBrowser?.catch(() => undefined));
    const entries = [...this.pages.values()];
    const contexts = [...new Set(entries.map((entry) => entry.context))];
    this.pages.clear();
    if (this.browser === browser) this.browser = undefined;
    if (browser) {
      await closeBrowser(browser);
    } else {
      await Promise.all(entries.map((entry) => teardownBounded(entry.page.close())));
      await Promise.all(contexts.map((context) => teardownBounded(context.close())));
    }
  }
}
