import { describe, expect, it } from "vitest";
import { createMockProvider } from "../src/mock-provider.js";
import { ControlTestStepsOutput, buildControlTestStepsPrompt } from "../src/index.js";
import { toStrictJsonSchema } from "../src/structured.js";

const CONTROL = {
  code: "AST-01",
  title: "Asset inventory",
  description: "Keep a list of the organisation's assets.",
  guidance: ["List laptops and servers.", "Name an owner for each."],
};

describe("control test steps prompt", () => {
  it("carries only the library control, wrapped in the user message", () => {
    const prompt = buildControlTestStepsPrompt(CONTROL);
    expect(prompt.messages).toHaveLength(1);
    const content = prompt.messages[0]?.content ?? "";
    expect(content.startsWith("<control>")).toBe(true);
    expect(content.endsWith("</control>")).toBe(true);
    for (const value of [CONTROL.code, CONTROL.title, CONTROL.description, ...CONTROL.guidance])
      expect(content).toContain(value);
    expect(prompt.system).not.toContain("Asset inventory");
    expect(prompt.system).toMatch(/JSON/);
  });

  it("takes no organisation data: extra fields never reach the prompt", () => {
    const withExtra = {
      ...CONTROL,
      organisation: "Northwind Payments",
      risk: "R-0001 lost laptop",
    };
    const prompt = buildControlTestStepsPrompt(withExtra);
    const all = prompt.system + prompt.messages.map((m) => m.content).join("");
    expect(all).not.toContain("Northwind");
    expect(all).not.toContain("R-0001");
    expect(prompt).toEqual(buildControlTestStepsPrompt(CONTROL));
  });

  it("has a strict output schema of 3-7 steps", () => {
    expect(() => toStrictJsonSchema(ControlTestStepsOutput)).not.toThrow();
    expect(ControlTestStepsOutput.safeParse({ steps: ["a", "b"] }).success).toBe(false);
    expect(ControlTestStepsOutput.safeParse({ steps: Array(8).fill("a") }).success).toBe(false);
    expect(ControlTestStepsOutput.safeParse({ steps: ["a", "b", "x".repeat(301)] }).success).toBe(
      false,
    );
  });
});

describe("mock control_test_steps reply", () => {
  it("returns three to seven steps naming the control", async () => {
    const prompt = buildControlTestStepsPrompt(CONTROL);
    const result = await createMockProvider().complete({
      model: "mock/isms-test",
      system: prompt.system,
      messages: prompt.messages,
      schemaName: "control_test_steps",
      jsonSchema: toStrictJsonSchema(ControlTestStepsOutput),
      maxTokens: 100,
      timeoutMs: 1000,
    });
    const { steps } = ControlTestStepsOutput.parse(JSON.parse(result.content));
    expect(steps.length).toBeGreaterThanOrEqual(3);
    expect(steps.length).toBeLessThanOrEqual(7);
    expect(steps.join(" ")).toContain("AST-01");
  });
});
