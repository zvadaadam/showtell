/** Static determinism and resource-policy lint for bundle v3 browser visuals. */
import * as ts from "typescript";
import type { BundleError } from "./bundle.ts";
import {
  WEB_MANIFEST_SCRIPT_TYPE,
  isWebElement,
  parseWebDocument,
  visitWebNodes,
  webAttribute,
  webElementText,
  type WebDocument,
} from "./web-document.ts";
const SMIL_ELEMENTS = new Set(["animate", "animatemotion", "animatetransform", "set"]);
const RESOURCE_ATTRIBUTES: Record<string, readonly string[]> = {
  script: ["src"],
  link: ["href"],
  img: ["src", "srcset"],
  source: ["src", "srcset"],
  video: ["src", "poster"],
  audio: ["src"],
  iframe: ["src"],
  object: ["data"],
};

function error(code: string, path: string, message: string, hint: string): BundleError {
  return { code, path, message, hint };
}

function calledName(expression: ts.Expression): string | undefined {
  while (ts.isParenthesizedExpression(expression)) expression = expression.expression;
  if (ts.isIdentifier(expression)) return expression.text;
  if (ts.isPropertyAccessExpression(expression)) return expression.name.text;
  if (ts.isElementAccessExpression(expression)) {
    const argument = expression.argumentExpression;
    if (argument && (ts.isStringLiteral(argument) || ts.isNoSubstitutionTemplateLiteral(argument))) {
      return argument.text;
    }
  }
  return undefined;
}

function memberRoot(expression: ts.Expression): string | undefined {
  while (
    ts.isParenthesizedExpression(expression) ||
    ts.isAsExpression(expression) ||
    ts.isSatisfiesExpression(expression)
  ) {
    expression = expression.expression;
  }
  if (ts.isIdentifier(expression)) return expression.text;
  if (ts.isPropertyAccessExpression(expression) || ts.isElementAccessExpression(expression)) {
    return memberRoot(expression.expression);
  }
  return undefined;
}

function memberPath(expression: ts.Expression): string[] | undefined {
  while (
    ts.isParenthesizedExpression(expression) ||
    ts.isAsExpression(expression) ||
    ts.isSatisfiesExpression(expression)
  ) {
    expression = expression.expression;
  }
  if (ts.isIdentifier(expression)) return [expression.text];
  if (ts.isPropertyAccessExpression(expression)) {
    const base = memberPath(expression.expression);
    return base ? [...base, expression.name.text] : undefined;
  }
  if (ts.isElementAccessExpression(expression)) {
    const argument = expression.argumentExpression;
    const base = memberPath(expression.expression);
    if (base && argument && (ts.isStringLiteral(argument) || ts.isNoSubstitutionTemplateLiteral(argument))) {
      return [...base, argument.text];
    }
  }
  return undefined;
}

function lintScript(source: string, path: string, errors: BundleError[], reported: Set<string>): void {
  const file = ts.createSourceFile(path, source, ts.ScriptTarget.ESNext, true, ts.ScriptKind.JS);
  const report = (api: string, hint: string): void => {
    if (reported.has(`api:${api}`)) return;
    reported.add(`api:${api}`);
    errors.push(error("BANNED_WEB_API", path, `Web visual uses banned API "${api}".`, hint));
  };

  const visit = (node: ts.Node): void => {
    if ((ts.isImportDeclaration(node) || ts.isExportDeclaration(node)) && node.moduleSpecifier) {
      report("static import", "Web visuals are self-contained; use injected gsap and declared Showtell inputs.");
    }
    if (ts.isCallExpression(node)) {
      if (node.expression.kind === ts.SyntaxKind.ImportKeyword) {
        report("import(", "Dynamic imports are unavailable; keep the visual in one bundle-local HTML file.");
      }
      const name = calledName(node.expression);
      const path = memberPath(node.expression);
      if (name === "fetch")
        report("fetch", "Declare assets or repo refs in spec.json; browser network access is disabled.");
      if (name === "setTimeout" || name === "setInterval" || name === "requestAnimationFrame") {
        report(name, "Drive motion from the paused GSAP timeline and Showtell semantic ranges.");
      }
      if (name === "animate") {
        report("Element.animate", "Put all motion on the paused GSAP timeline so Showtell can seek it exactly.");
      }
      if (name === "eval" || name === "Function") report(name, "Author literal deterministic JavaScript instead.");
      if (name === "Date") report("Date", "Use window.__showtell.time instead of wall-clock time.");
      if (path?.at(-2) === "crypto" && (path.at(-1) === "getRandomValues" || path.at(-1) === "randomUUID")) {
        report(`crypto.${path.at(-1)}`, "Use window.__showtell.random(key).");
      }
    }
    if (ts.isNewExpression(node)) {
      const name = calledName(node.expression);
      if (name === "Date") report("new Date", "Use window.__showtell.time instead of wall-clock time.");
      if (name === "Animation" || name === "KeyframeEffect") {
        report(`new ${name}`, "Put all motion on the paused GSAP timeline so Showtell can seek it exactly.");
      }
      if (["WebSocket", "EventSource", "XMLHttpRequest", "Worker", "SharedWorker"].includes(name ?? "")) {
        report(name!, "Browser network and background workers are disabled; use declared inputs.");
      }
    }
    if (ts.isPropertyAccessExpression(node) || ts.isElementAccessExpression(node)) {
      const root = memberRoot(node.expression);
      const name = calledName(node);
      if (root === "Math" && name === "random") report("Math.random", "Use window.__showtell.random(key).");
      if ((root === "Date" || root === "performance") && name === "now") {
        report(`${root}.now`, "Use window.__showtell.time.");
      }
    }
    ts.forEachChild(node, visit);
  };
  visit(file);
}

function lintStyle(source: string, path: string, errors: BundleError[], reported: Set<string>): void {
  const report = (key: string, message: string, hint: string): void => {
    if (reported.has(`css:${key}`)) return;
    reported.add(`css:${key}`);
    errors.push(error("BANNED_WEB_CSS", path, message, hint));
  };
  if (/@import\b/i.test(source)) {
    report("import", "Web visual CSS uses @import.", "Inline styles and use renderer-provided font/theme variables.");
  }
  if (/url\(\s*["']?(?!data:)/i.test(source)) {
    report("url", "Web visual CSS loads a URL.", "Use declared assets through renderer-owned web components.");
  }
  if (/(?:^|[;{])\s*(?:animation|transition)(?:-[\w-]+)?\s*:/im.test(source)) {
    report(
      "ambient-motion",
      "Web visual CSS declares an animation or transition.",
      "Put motion on the paused GSAP timeline so review and render can seek it exactly.",
    );
  }
}

export function validateWebSource(
  source: string,
  path: string,
  errors: BundleError[],
  document: WebDocument = parseWebDocument(source),
): void {
  const reported = new Set<string>();

  visitWebNodes(document, (node) => {
    if (isWebElement(node)) {
      if (SMIL_ELEMENTS.has(node.tagName.toLowerCase()) && !reported.has("smil")) {
        reported.add("smil");
        errors.push(
          error(
            "BANNED_WEB_ANIMATION",
            path,
            `Web visual uses SVG SMIL element <${node.tagName}>.`,
            "Animate SVG properties from the paused GSAP timeline instead.",
          ),
        );
      }
      for (const item of node.attrs) {
        if (item.name.toLowerCase().startsWith("on")) {
          const key = `handler:${item.name.toLowerCase()}`;
          if (!reported.has(key)) {
            reported.add(key);
            errors.push(
              error(
                "BANNED_WEB_HANDLER",
                path,
                `Web visual uses inline event handler "${item.name}".`,
                "Attach deterministic handlers from the main inline script, or remove interaction from rendered video.",
              ),
            );
          }
        }
      }
      for (const name of RESOURCE_ATTRIBUTES[node.tagName] ?? []) {
        const value = webAttribute(node, name);
        if (!value) continue;
        const key = `resource:${node.tagName}:${name}`;
        if (!reported.has(key)) {
          reported.add(key);
          errors.push(
            error(
              "BANNED_WEB_RESOURCE",
              path,
              `Web visual declares external resource <${node.tagName} ${name}="${value}">.`,
              "Declare the resource in spec.json and render it through a Showtell web component; scripts use injected gsap.",
            ),
          );
        }
      }
      if (node.tagName === "script" && webAttribute(node, "type")?.toLowerCase() !== WEB_MANIFEST_SCRIPT_TYPE) {
        lintScript(webElementText(node), path, errors, reported);
      }
      if (node.tagName === "style") lintStyle(webElementText(node), path, errors, reported);
      const inlineStyle = webAttribute(node, "style");
      if (inlineStyle) lintStyle(inlineStyle, path, errors, reported);
    }
  });
}
