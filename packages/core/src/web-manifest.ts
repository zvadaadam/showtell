import { createHash } from "node:crypto";
import { z } from "zod";
import { VisualInputDescriptor, VisualInputId } from "./visual-input-contract.ts";
import {
  WEB_MANIFEST_SCRIPT_TYPE,
  isWebElement,
  parseWebDocument,
  visitWebNodes,
  webAttribute,
  webElementText,
  type WebDocument,
  type WebElement,
} from "./web-document.ts";

const DEFAULT_PROPS_SCHEMA = { type: "object", additionalProperties: true } as const;

const WebManifestSchema = z
  .object({
    schemaVersion: z.literal(3),
    propsSchema: z.record(z.unknown()).default(DEFAULT_PROPS_SCHEMA),
    inputs: z.record(VisualInputId, VisualInputDescriptor).default({}),
  })
  .strict();

export interface WebManifest extends z.infer<typeof WebManifestSchema> {
  sourceSha256: string;
}

export class WebManifestError extends Error {
  readonly code: string;
  readonly path: string;

  constructor(code: string, path: string, message: string) {
    super(message);
    this.name = "WebManifestError";
    this.code = code;
    this.path = path;
  }
}

export function loadWebManifestFromSource(source: string, document = parseWebDocument(source)): WebManifest {
  const scripts = findManifestScripts(document);
  if (scripts.length === 0) {
    throw new WebManifestError(
      "MISSING_WEB_MANIFEST",
      "script[type=application/showtell+json]",
      "HTML must contain exactly one Showtell manifest script.",
    );
  }
  if (scripts.length > 1) {
    throw new WebManifestError(
      "DUPLICATE_WEB_MANIFEST",
      "script[type=application/showtell+json]",
      "HTML contains more than one Showtell manifest script.",
    );
  }

  let data: unknown;
  try {
    data = JSON.parse(webElementText(scripts[0]!));
  } catch (e) {
    throw new WebManifestError(
      "INVALID_WEB_MANIFEST_JSON",
      "script[type=application/showtell+json]",
      `Invalid Showtell manifest JSON: ${(e as Error).message}`,
    );
  }

  if (!isRecord(data)) {
    throw new WebManifestError("INVALID_WEB_MANIFEST", "schemaVersion", "Showtell manifest must be a JSON object.");
  }
  if (data.schemaVersion !== 3) {
    throw new WebManifestError(
      "WRONG_WEB_MANIFEST_VERSION",
      "schemaVersion",
      "Showtell web manifests must declare schemaVersion 3.",
    );
  }

  const parsed = WebManifestSchema.safeParse(data);
  if (!parsed.success) {
    const issue = parsed.error.issues[0]!;
    throw new WebManifestError(
      "INVALID_WEB_MANIFEST",
      issuePath(issue.path),
      `Invalid Showtell web manifest: ${issue.message}`,
    );
  }

  return {
    ...parsed.data,
    sourceSha256: createHash("sha256").update(source).digest("hex"),
  };
}

function findManifestScripts(document: WebDocument): WebElement[] {
  const scripts: WebElement[] = [];
  visitWebNodes(document, (node) => {
    if (!isWebElement(node)) return;
    const type = webAttribute(node, "type");
    if (node.tagName === "script" && type?.toLowerCase() === WEB_MANIFEST_SCRIPT_TYPE) scripts.push(node);
  });
  return scripts;
}

function issuePath(path: (string | number)[]): string {
  return path.length ? path.join(".") : "(manifest)";
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return !!value && typeof value === "object" && !Array.isArray(value);
}
