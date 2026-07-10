/** Element-tree utilities shared by the hyperframe renderers. */
import type { HyperframeChild, HyperframeElement } from "@showtell/hyperframes";

export function isElement(value: HyperframeChild): value is HyperframeElement {
  return Boolean(value && typeof value === "object" && !Array.isArray(value) && "type" in value && "props" in value);
}

export function flattenChildren(children: HyperframeChild[]): HyperframeChild[] {
  const out: HyperframeChild[] = [];
  for (const child of children) {
    if (Array.isArray(child)) out.push(...flattenChildren(child));
    else if (child !== null && child !== undefined && child !== false) out.push(child);
  }
  return out;
}

export function elementChildren(element: HyperframeElement): HyperframeChild[] {
  return flattenChildren(element.children);
}

export function elementChildElements(element: HyperframeElement): HyperframeElement[] {
  return elementChildren(element).filter(isElement);
}

export function textContent(children: HyperframeChild[]): string {
  return flattenChildren(children)
    .map((child) => {
      if (typeof child === "string" || typeof child === "number") return String(child);
      if (isElement(child)) return textContent(elementChildren(child));
      return "";
    })
    .filter(Boolean)
    .join(" ")
    .replace(/\s+/g, " ")
    .trim();
}
