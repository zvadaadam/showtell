import { test, expect } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { loadHyperframeContractFromSource } from "@agent-video/core";
import { DecisionGrid, PhaseBanner, h, hyperframeComponents, hyperframeTemplates } from "../src/index.ts";

const ROOT = join(import.meta.dir, "..", "..", "..");

test("starter templates expose valid static hyperframe contracts", () => {
  expect(hyperframeTemplates.length).toBeGreaterThan(0);
  for (const template of hyperframeTemplates) {
    const source = readFileSync(join(ROOT, template.path), "utf-8");
    const contract = loadHyperframeContractFromSource(source);
    expect(contract.schemaVersion).toBe(1);
    expect(contract.propsSchema).toHaveProperty("type");
    const requiredInputs = Object.entries(contract.inputs)
      .filter(([, input]) => !input.optional)
      .map(([name]) => name)
      .sort();
    expect([...template.requiredInputs].sort()).toEqual(requiredInputs);
    if (template.visualCaption) {
      expect(source).toContain("KineticCaption");
    }
  }
});

test("component kit exposes reusable function components", () => {
  expect(hyperframeComponents.map((component) => component.importName)).toContain("DecisionGrid");
  expect(hyperframeComponents.some((component) => component.layer === "story")).toBe(true);
  expect(hyperframeComponents.some((component) => component.layer === "media")).toBe(true);

  const banner = h(PhaseBanner, { eyebrow: "model", title: "Reusable components", phase: 1 });
  expect(banner.type).toBe("Stack");

  const grid = h(DecisionGrid, {
    options: ["JSON contract", "Hyperframe component", "Renderer execution"],
    activeIndex: 1,
  });
  expect(grid.type).toBe("Grid");
});

test("component manifest only advertises renderer-backed props", () => {
  const byImport = new Map(hyperframeComponents.map((component) => [component.importName, component]));

  expect(byImport.get("Stack")?.commonProps).not.toContain("align");
  expect(byImport.get("Text")?.commonProps).not.toContain("balance");
  expect(byImport.get("DiffRef")?.commonProps).not.toContain("mode");
});

test("starter templates do not expose vestigial focus props", () => {
  for (const id of ["diff-review", "single-proof", "image-callout"]) {
    const template = hyperframeTemplates.find((candidate) => candidate.id === id);
    expect(template).toBeDefined();
    const source = readFileSync(join(ROOT, template!.path), "utf-8");
    const contract = loadHyperframeContractFromSource(source);
    expect(contract.propsSchema).toHaveProperty("type", "object");
    if (typeof contract.propsSchema === "object" && contract.propsSchema !== null) {
      expect(contract.propsSchema.properties ?? {}).not.toHaveProperty("focus");
    }
  }
});
