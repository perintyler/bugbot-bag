import { describe, it, expect } from "vitest";
import * as tools from "./tools.js";

const allTools = Object.values(tools).filter(
  (v): v is { name: string; namespace: string; handler: Function; description: string } =>
    typeof v === "object" && v !== null && "name" in v && "handler" in v,
);

describe("tool exports", () => {
  it("exports at least one tool", () => {
    expect(allTools.length).toBeGreaterThan(0);
  });

  for (const tool of allTools) {
    describe(tool.name, () => {
      it("has required fields", () => {
        expect(tool.name).toBeTruthy();
        expect(tool.namespace).toBeTruthy();
        expect(typeof tool.handler).toBe("function");
        expect(tool.description).toBeTruthy();
      });
    });
  }
});
