import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import en from "../../messages/index";

const file = readFileSync(join(process.cwd(), "messages/en/report.json"), "utf8");

describe("report.json", () => {
  it("report.json never uses residual risk, treatment or Annex A", () => {
    const text = file.toLowerCase();
    for (const word of ["residual risk", "residual", "treatment", "annex a", "annex"]) {
      expect(text, word).not.toContain(word);
    }
  });

  it("starts the conversation with the exact first prompt", () => {
    expect(en.report.chat.firstPrompt).toBe("What are you worried might happen?");
  });

  it("names every concern status in plain words", () => {
    expect(en.concerns.status).toEqual({
      proposed: "Waiting for review",
      in_review: "Reviewed — waiting for approval",
      approved: "Reviewed and approved",
      returned: "Being looked at again",
      closed: "Treated",
    });
  });

  it("explains a failed turn in one plain message", () => {
    expect(en.report.form.fallback).toBe(
      "The assistant couldn't continue. Your answers are kept — finish with the form below.",
    );
  });
});
