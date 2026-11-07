import { describe, expect, it } from "vitest";
import { TEXT_FIELDS, fieldAudit } from "../../src/risks/risk-edit-audit.js";

const OLD = "Jane from payroll left the note on her desk.";

describe("fieldAudit (free text by length only, whatever the value's type)", () => {
  it("records a text field's new value by length, never the old text", () => {
    expect(fieldAudit("treatmentNote", OLD, "Locked away.")).toEqual({
      after: { changed: true, length: "Locked away.".length },
    });
  });

  it.each([null, 42, ["a"]])("a text field cleared to %j still records no old text", (next) => {
    for (const field of TEXT_FIELDS) {
      const entry = fieldAudit(field, OLD, next);
      expect(JSON.stringify(entry)).not.toContain("Jane");
      expect(entry).toEqual({ after: { changed: true, length: 0 } });
    }
  });

  it("records counts for toConfirm and values for everything else", () => {
    expect(fieldAudit("toConfirm", ["Which floor?"], [])).toEqual({
      before: { count: 1 },
      after: { count: 0 },
    });
    expect(fieldAudit("likelihood", null, 3)).toEqual({ before: null, after: 3 });
  });
});
