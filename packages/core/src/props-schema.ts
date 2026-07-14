export interface JsonSchemaIssue {
  kind: "schema" | "value";
  path: string;
  message: string;
}

/** Validate the small deterministic JSON-Schema dialect supported by web visual props. */
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

const SUPPORTED_SCHEMA_TYPES = new Set(["array", "object", "integer", "number", "string", "boolean"]);

const NON_NEGATIVE_INTEGER_KEYS = ["minLength", "maxLength", "minItems", "maxItems"] as const;
const NUMBER_KEYS = ["minimum", "maximum"] as const;

function validateSchemaDialect(schema: unknown, path: string, issues: JsonSchemaIssue[]): void {
  if (!isRecord(schema)) {
    issues.push({ kind: "schema", path, message: "Supported propsSchema nodes must be objects." });
    return;
  }
  for (const key of Object.keys(schema)) {
    if (!SUPPORTED_SCHEMA_KEYS.has(key)) {
      issues.push({
        kind: "schema",
        path,
        message: `Unsupported propsSchema keyword "${key}".`,
      });
    }
  }
  if (schema.type !== undefined) {
    if (typeof schema.type !== "string") {
      issues.push({ path: `${path}.type`, kind: "schema", message: "Supported propsSchema type must be a string." });
    } else if (!SUPPORTED_SCHEMA_TYPES.has(schema.type)) {
      issues.push({
        path: `${path}.type`,
        kind: "schema",
        message: `Unsupported propsSchema type "${schema.type}".`,
      });
    }
  }
  if (schema.enum !== undefined && !Array.isArray(schema.enum)) {
    issues.push({ path: `${path}.enum`, kind: "schema", message: "Supported propsSchema enum must be an array." });
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
  if (schema.additionalProperties !== undefined && typeof schema.additionalProperties !== "boolean") {
    issues.push({
      kind: "schema",
      path: `${path}.additionalProperties`,
      message: "Supported propsSchema additionalProperties must be boolean.",
    });
  }
  for (const key of NON_NEGATIVE_INTEGER_KEYS) {
    const value = schema[key];
    if (value !== undefined && (typeof value !== "number" || !Number.isInteger(value) || value < 0)) {
      issues.push({
        kind: "schema",
        path: `${path}.${key}`,
        message: `Supported propsSchema ${key} must be a non-negative integer.`,
      });
    }
  }
  for (const key of NUMBER_KEYS) {
    if (schema[key] !== undefined && typeof schema[key] !== "number") {
      issues.push({
        kind: "schema",
        path: `${path}.${key}`,
        message: `Supported propsSchema ${key} must be a number.`,
      });
    }
  }
  if (isRecord(schema.properties)) {
    for (const [key, child] of Object.entries(schema.properties)) {
      validateSchemaDialect(child, `${path}.properties.${key}`, issues);
    }
  }
  if (schema.items !== undefined) validateSchemaDialect(schema.items, `${path}.items`, issues);
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
    if (Object.prototype.hasOwnProperty.call(value, key)) {
      validateSchemaNode(child, value[key], `${path}.${key}`, issues);
    }
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
