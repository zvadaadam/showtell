import { parse, type DefaultTreeAdapterMap } from "parse5";

export const WEB_MANIFEST_SCRIPT_TYPE = "application/showtell+json";

export type WebDocument = DefaultTreeAdapterMap["document"];
export type WebNode = DefaultTreeAdapterMap["node"];
export type WebElement = DefaultTreeAdapterMap["element"];

export function parseWebDocument(source: string): WebDocument {
  return parse(source);
}

export function visitWebNodes(root: WebNode, visitor: (node: WebNode) => void): void {
  visitor(root);
  if ("childNodes" in root) {
    for (const child of root.childNodes) visitWebNodes(child, visitor);
  }
}

export function isWebElement(node: WebNode): node is WebElement {
  return "tagName" in node;
}

export function webAttribute(element: WebElement, name: string): string | undefined {
  return element.attrs.find((item) => item.name.toLowerCase() === name)?.value;
}

export function webElementText(element: WebElement): string {
  return element.childNodes
    .filter((child): child is DefaultTreeAdapterMap["textNode"] => child.nodeName === "#text")
    .map((child) => child.value)
    .join("");
}
