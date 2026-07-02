/** Static policy lint for bundle hyperframe source files. */
import * as ts from "typescript";
import type { BundleError } from "./bundle.ts";

function err(code: string, path: string, message: string, hint: string): BundleError {
  return { code, path, message, hint };
}

export function validateHyperframeSource(text: string, path: string, errors: BundleError[]): void {
  const file = ts.createSourceFile(path, text, ts.ScriptTarget.ESNext, true, ts.ScriptKind.TSX);
  const reported = new Set<string>();

  const reportApi = (api: string, hint: string): void => {
    const key = `api:${api}`;
    if (reported.has(key)) return;
    reported.add(key);
    errors.push(err("BANNED_HYPERFRAME_API", path, `Hyperframe uses banned API "${api}".`, hint));
  };

  const reportImport = (specifier: string): void => {
    const key = `import:${specifier}`;
    if (reported.has(key)) return;
    reported.add(key);
    errors.push(
      err(
        "BANNED_HYPERFRAME_IMPORT",
        path,
        `Hyperframe imports unsupported module "${specifier}".`,
        'Hyperframes may import only from "@agent-video/hyperframes"; declare assets and repo refs in spec.json.',
      ),
    );
  };

  const checkModuleSpecifier = (specifier: string): void => {
    if (specifier !== "@agent-video/hyperframes") reportImport(specifier);
  };

  const expressionRoot = (node: ts.Expression): string | undefined => {
    node = unwrapExpression(node);
    if (ts.isIdentifier(node)) return node.text;
    if (ts.isPropertyAccessExpression(node) || ts.isElementAccessExpression(node)) {
      return expressionRoot(node.expression);
    }
    return undefined;
  };

  const literalMember = (node: ts.Node | undefined): string | undefined => {
    if (!node) return undefined;
    if (ts.isIdentifier(node) || ts.isStringLiteral(node) || ts.isNoSubstitutionTemplateLiteral(node)) return node.text;
    if (ts.isNumericLiteral(node)) return node.text;
    return undefined;
  };

  const memberAccess = (node: ts.Node): { root: string; member?: string } | undefined => {
    if (ts.isPropertyAccessExpression(node))
      return { root: expressionRoot(node.expression) ?? "", member: node.name.text };
    if (ts.isElementAccessExpression(node)) {
      return { root: expressionRoot(node.expression) ?? "", member: literalMember(node.argumentExpression) };
    }
    return undefined;
  };

  const checkMemberAccess = (node: ts.Node): void => {
    const access = memberAccess(node);
    if (!access) return;
    const { root, member } = access;
    if (root === "Date" && member === "now") reportApi("Date.now", "Use ctx.time instead of Date.now().");
    if (root === "performance" && member === "now")
      reportApi("performance.now", "Use ctx.time instead of performance.now().");
    if (root === "Math" && member === "random")
      reportApi("Math.random", "Use ctx.random(key) for deterministic randomness.");
    if (root === "crypto" && member === "randomUUID")
      reportApi("crypto.randomUUID", "Use ctx.random(key) for deterministic randomness.");
    if (root === "process") reportApi("process.", "Hyperframes cannot inspect process state.");
    if (root === "globalThis")
      reportApi("globalThis", "Hyperframes cannot reach ambient globals; use renderer-provided ctx.");
    if (member === "readFile" || member === "readFileSync")
      reportApi("readFile", "Hyperframes cannot read files; declare assets or repo refs.");
  };

  const calledName = (node: ts.Expression): string | undefined => {
    node = unwrapExpression(node);
    if (ts.isIdentifier(node)) return node.text;
    const access = memberAccess(node);
    return access?.member;
  };

  const visit = (node: ts.Node): void => {
    if (
      (ts.isImportDeclaration(node) || ts.isExportDeclaration(node)) &&
      node.moduleSpecifier &&
      ts.isStringLiteral(node.moduleSpecifier)
    ) {
      checkModuleSpecifier(node.moduleSpecifier.text);
    }

    if (ts.isCallExpression(node)) {
      if (node.expression.kind === ts.SyntaxKind.ImportKeyword) {
        reportApi("import(", "Hyperframes cannot use dynamic imports.");
      }
      const name = calledName(node.expression);
      if (name === "fetch") reportApi("fetch(", "Hyperframes cannot call the network; declare assets in spec.json.");
      if (name === "require")
        reportApi("require(", "Hyperframes cannot import modules dynamically; use @agent-video/hyperframes only.");
      if (name === "eval") reportApi("eval(", "Hyperframes cannot use eval.");
      if (name === "Function") reportApi("Function(", "Hyperframes cannot construct functions dynamically.");
      if (name === "setTimeout") reportApi("setTimeout", "Hyperframes cannot use timers; animate from ctx.time.");
      if (name === "setInterval") reportApi("setInterval", "Hyperframes cannot use timers; animate from ctx.time.");
      if (name === "Date") reportApi("Date", "Use ctx.time instead of wall-clock dates.");
      checkMemberAccess(node.expression);
    }

    if (ts.isNewExpression(node)) {
      const name = calledName(node.expression);
      if (name === "Date") reportApi("new Date", "Use ctx.time instead of wall-clock dates.");
      if (name === "Function") reportApi("Function(", "Hyperframes cannot construct functions dynamically.");
      checkMemberAccess(node.expression);
    }

    if (ts.isPropertyAccessExpression(node) || ts.isElementAccessExpression(node)) checkMemberAccess(node);
    if (ts.isAwaitExpression(node))
      reportApi("await ", "Hyperframes must be synchronous; use declared inputs resolved by the renderer.");
    if (ts.isMetaProperty(node) && node.keywordToken === ts.SyntaxKind.ImportKeyword)
      reportApi("import.meta", "Hyperframes cannot inspect import metadata.");

    ts.forEachChild(node, visit);
  };

  visit(file);
}

function unwrapExpression(node: ts.Expression): ts.Expression {
  while (ts.isParenthesizedExpression(node) || ts.isAsExpression(node) || ts.isSatisfiesExpression(node)) {
    node = node.expression;
  }
  return node;
}
