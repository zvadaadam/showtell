import { createHash } from "node:crypto";
import * as ts from "typescript";
import { z } from "zod";
import { ID_PATTERN } from "./id.ts";

const Id = z
  .string()
  .regex(new RegExp(`^${ID_PATTERN}$`), "Use 1-64 chars: letters, digits, underscore, hyphen; start with a letter.");

const HyperframeInput = z.discriminatedUnion("kind", [
  z
    .object({
      kind: z.literal("repo"),
      refKind: z.enum(["code", "diff"]).optional(),
      optional: z.boolean().default(false),
    })
    .strict(),
  z
    .object({
      kind: z.literal("asset"),
      assetType: z.enum(["audio", "data", "image"]).optional(),
      optional: z.boolean().default(false),
    })
    .strict(),
  z.object({ kind: z.literal("range"), optional: z.boolean().default(false) }).strict(),
]);

const HyperframeContractSchema = z
  .object({
    schemaVersion: z.literal(1),
    propsSchema: z.record(z.unknown()),
    inputs: z.record(Id, HyperframeInput).default({}),
  })
  .strict();

export type BundleHyperframeInput = z.infer<typeof HyperframeInput>;

export interface HyperframeContract extends z.infer<typeof HyperframeContractSchema> {
  sourceSha256: string;
}

export interface JsonSchemaIssue {
  kind: "schema" | "value";
  path: string;
  message: string;
}

export function loadHyperframeContractFromSource(source: string): HyperframeContract {
  const file = ts.createSourceFile("hyperframe.tsx", source, ts.ScriptTarget.ESNext, true, ts.ScriptKind.TSX);
  const vars = collectConstInitializers(file);
  const exported = defaultExportMembers(file);

  if (!exported.has("render")) throw new Error('Default export must include a "render" function.');

  const schemaVersion = readLiteralMember(exported, vars, "schemaVersion");
  const propsSchema = readLiteralMember(exported, vars, "propsSchema");
  const inputs = readLiteralMember(exported, vars, "inputs");
  const parsed = HyperframeContractSchema.parse({ schemaVersion, propsSchema, inputs });
  return {
    ...parsed,
    sourceSha256: createHash("sha256").update(source).digest("hex"),
  };
}

export function validateJsonSchemaValue(
  schema: unknown,
  value: unknown,
  path: string,
  schemaPath = path,
): JsonSchemaIssue[] {
  const issues: JsonSchemaIssue[] = [];
  validateSchemaDialect(schema, schemaPath, issues);
  validateSchemaNode(schema, value, path, issues);
  return issues;
}

function collectConstInitializers(file: ts.SourceFile): Map<string, ts.Expression> {
  const vars = new Map<string, ts.Expression>();

  function visit(node: ts.Node): void {
    if (ts.isVariableStatement(node)) {
      const isConst = (node.declarationList.flags & ts.NodeFlags.Const) !== 0;
      if (isConst) {
        for (const decl of node.declarationList.declarations) {
          if (ts.isIdentifier(decl.name) && decl.initializer) vars.set(decl.name.text, decl.initializer);
        }
      }
    }
    ts.forEachChild(node, visit);
  }

  visit(file);
  return vars;
}

function defaultExportMembers(file: ts.SourceFile): Map<string, ts.Expression> {
  let exported: Map<string, ts.Expression> | undefined;

  function visit(node: ts.Node): void {
    if (ts.isExportAssignment(node)) {
      const expr = unwrap(node.expression);
      if (ts.isObjectLiteralExpression(expr)) {
        exported = objectMembers(expr);
        return;
      }
      if (ts.isCallExpression(expr) && expr.arguments[0] && ts.isObjectLiteralExpression(unwrap(expr.arguments[0]))) {
        exported = objectMembers(unwrap(expr.arguments[0]) as ts.ObjectLiteralExpression);
        return;
      }
      throw new Error("Default export must be an object literal or defineHyperframe({...}) call.");
    }
    ts.forEachChild(node, visit);
  }

  visit(file);
  if (!exported) throw new Error("Hyperframe must have a default export object.");
  return exported;
}

function objectMembers(object: ts.ObjectLiteralExpression): Map<string, ts.Expression> {
  const members = new Map<string, ts.Expression>();
  for (const prop of object.properties) {
    if (ts.isPropertyAssignment(prop)) {
      members.set(propertyName(prop.name), prop.initializer);
    } else if (ts.isShorthandPropertyAssignment(prop)) {
      members.set(prop.name.text, prop.name);
    } else {
      throw new Error("Hyperframe default export may only contain plain properties.");
    }
  }
  return members;
}

function readLiteralMember(
  members: Map<string, ts.Expression>,
  vars: Map<string, ts.Expression>,
  name: string,
): unknown {
  const expr = members.get(name);
  if (!expr) throw new Error(`Default export must include "${name}".`);
  return literal(expr, vars);
}

function literal(node: ts.Expression, vars: Map<string, ts.Expression>): unknown {
  node = unwrap(node);
  if (ts.isStringLiteral(node) || ts.isNoSubstitutionTemplateLiteral(node)) return node.text;
  if (ts.isNumericLiteral(node)) return Number(node.text);
  if (node.kind === ts.SyntaxKind.TrueKeyword) return true;
  if (node.kind === ts.SyntaxKind.FalseKeyword) return false;
  if (node.kind === ts.SyntaxKind.NullKeyword) return null;
  if (ts.isIdentifier(node)) {
    const referenced = vars.get(node.text);
    if (!referenced) throw new Error(`Hyperframe contract references non-literal identifier "${node.text}".`);
    return literal(referenced, vars);
  }
  if (ts.isArrayLiteralExpression(node)) {
    return node.elements.map((item) => literal(item as ts.Expression, vars));
  }
  if (ts.isObjectLiteralExpression(node)) {
    const out: Record<string, unknown> = {};
    for (const prop of node.properties) {
      if (!ts.isPropertyAssignment(prop)) throw new Error("Hyperframe contract objects may only contain properties.");
      const key = propertyName(prop.name);
      out[key] = literal(prop.initializer, vars);
    }
    return out;
  }
  throw new Error("Hyperframe contract values must be JSON-literal constants.");
}

function unwrap(node: ts.Expression): ts.Expression {
  while (ts.isAsExpression(node) || ts.isSatisfiesExpression(node) || ts.isParenthesizedExpression(node)) {
    node = node.expression;
  }
  return node;
}

function propertyName(name: ts.PropertyName): string {
  if (ts.isIdentifier(name) || ts.isStringLiteral(name) || ts.isNumericLiteral(name)) return name.text;
  throw new Error("Hyperframe contract object keys must be literal strings.");
}

const SUPPORTED_SCHEMA_KEYS = new Set([
  "type",
  "enum",
  "additionalProperties",
  "required",
  "properties",
  "items",
  "minLength",
  "maxLength",
  "minimum",
  "maximum",
  "minItems",
  "maxItems",
]);

function validateSchemaDialect(schema: unknown, path: string, issues: JsonSchemaIssue[]): void {
  if (!isRecord(schema)) return;
  for (const key of Object.keys(schema)) {
    if (!SUPPORTED_SCHEMA_KEYS.has(key)) {
      issues.push({
        kind: "schema",
        path,
        message: `Unsupported propsSchema keyword "${key}".`,
      });
    }
  }
  if (schema.type !== undefined && typeof schema.type !== "string") {
    issues.push({ kind: "schema", path: `${path}.type`, message: "Supported propsSchema type must be a string." });
  }
  if (schema.properties !== undefined && !isRecord(schema.properties)) {
    issues.push({
      kind: "schema",
      path: `${path}.properties`,
      message: "Supported propsSchema properties must be an object.",
    });
  }
  if (schema.required !== undefined && !isStringArray(schema.required)) {
    issues.push({
      kind: "schema",
      path: `${path}.required`,
      message: "Supported propsSchema required must be a string array.",
    });
  }
  if (
    schema.additionalProperties !== undefined &&
    typeof schema.additionalProperties !== "boolean" &&
    schema.additionalProperties !== false
  ) {
    issues.push({
      kind: "schema",
      path: `${path}.additionalProperties`,
      message: "Supported propsSchema additionalProperties must be boolean.",
    });
  }
  if (isRecord(schema.properties)) {
    for (const [key, child] of Object.entries(schema.properties)) {
      validateSchemaDialect(child, `${path}.properties.${key}`, issues);
    }
  }
  if (schema.items) validateSchemaDialect(schema.items, `${path}.items`, issues);
}

function validateSchemaNode(schema: unknown, value: unknown, path: string, issues: JsonSchemaIssue[]): void {
  if (!isRecord(schema)) return;

  if (Array.isArray(schema.enum) && !schema.enum.some((item) => Object.is(item, value))) {
    issues.push({ kind: "value", path, message: `Expected one of: ${schema.enum.map(String).join(", ")}.` });
    return;
  }

  const type = typeof schema.type === "string" ? schema.type : undefined;
  if (type && !matchesType(type, value)) {
    issues.push({ kind: "value", path, message: `Expected ${type}.` });
    return;
  }

  if (type === "object" || (isRecord(value) && isRecord(schema.properties))) {
    validateObjectSchema(schema, value, path, issues);
  }
  if (type === "array" && Array.isArray(value)) {
    validateNumberLimit(schema.minItems, value.length, path, "at least", "items", issues, (a, b) => a < b);
    validateNumberLimit(schema.maxItems, value.length, path, "at most", "items", issues, (a, b) => a > b);
    if (schema.items) {
      value.forEach((item, index) => validateSchemaNode(schema.items, item, `${path}.${index}`, issues));
    }
  }
  if (type === "string" && typeof value === "string") {
    validateNumberLimit(schema.minLength, value.length, path, "at least", "characters", issues, (a, b) => a < b);
    validateNumberLimit(schema.maxLength, value.length, path, "at most", "characters", issues, (a, b) => a > b);
  }
  if ((type === "number" || type === "integer") && typeof value === "number") {
    validateNumberLimit(schema.minimum, value, path, "at least", "", issues, (a, b) => a < b);
    validateNumberLimit(schema.maximum, value, path, "at most", "", issues, (a, b) => a > b);
  }
}

function validateObjectSchema(
  schema: Record<string, unknown>,
  value: unknown,
  path: string,
  issues: JsonSchemaIssue[],
): void {
  if (!isRecord(value)) return;
  const properties = isRecord(schema.properties) ? schema.properties : {};
  const required = Array.isArray(schema.required)
    ? schema.required.filter((item): item is string => typeof item === "string")
    : [];

  for (const key of required) {
    if (!Object.prototype.hasOwnProperty.call(value, key)) {
      issues.push({ kind: "value", path: `${path}.${key}`, message: "Missing required property." });
    }
  }

  for (const [key, child] of Object.entries(properties)) {
    if (Object.prototype.hasOwnProperty.call(value, key))
      validateSchemaNode(child, value[key], `${path}.${key}`, issues);
  }

  if (schema.additionalProperties === false) {
    for (const key of Object.keys(value)) {
      if (!Object.prototype.hasOwnProperty.call(properties, key)) {
        issues.push({ kind: "value", path: `${path}.${key}`, message: "Unknown property." });
      }
    }
  }
}

function matchesType(type: string, value: unknown): boolean {
  if (type === "array") return Array.isArray(value);
  if (type === "object") return isRecord(value);
  if (type === "integer") return Number.isInteger(value);
  if (type === "number") return typeof value === "number";
  if (type === "string") return typeof value === "string";
  if (type === "boolean") return typeof value === "boolean";
  return true;
}

function validateNumberLimit(
  limit: unknown,
  actual: number,
  path: string,
  phrase: "at least" | "at most",
  unit: string,
  issues: JsonSchemaIssue[],
  fails: (actual: number, limit: number) => boolean,
): void {
  if (typeof limit !== "number") return;
  if (fails(actual, limit)) {
    const suffix = unit ? ` ${unit}` : "";
    issues.push({ kind: "value", path, message: `Expected ${phrase} ${limit}${suffix}.` });
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return !!value && typeof value === "object" && !Array.isArray(value);
}

function isStringArray(value: unknown): value is string[] {
  return Array.isArray(value) && value.every((item) => typeof item === "string");
}
