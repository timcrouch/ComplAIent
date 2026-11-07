import { describe, expect, it } from "vitest";
import { EvidenceRequestInput, EvidenceUploadQuery, TaskUploadQuery } from "../src/index.js";

const id = (n: number) => `0190f0f0-0000-7000-8000-00000000000${String(n)}`;

describe("evidence contracts", () => {
  it("parses the upload query: comma-separated control ids, internal by default", () => {
    expect(
      EvidenceUploadQuery.parse({
        fileName: "policy.pdf",
        mimeType: "application/pdf",
        controlIds: `${id(1)},${id(2)}`,
      }),
    ).toEqual({
      fileName: "policy.pdf",
      mimeType: "application/pdf",
      classification: "internal",
      controlIds: [id(1), id(2)],
    });
    const base = { fileName: "a.pdf", mimeType: "application/pdf" };
    expect(EvidenceUploadQuery.safeParse({ ...base, controlIds: "" }).success).toBe(false);
    expect(EvidenceUploadQuery.safeParse({ ...base, controlIds: "nope" }).success).toBe(false);
    const eleven = Array.from({ length: 11 }, () => id(1)).join(",");
    expect(EvidenceUploadQuery.safeParse({ ...base, controlIds: eleven }).success).toBe(false);
    expect(
      EvidenceUploadQuery.safeParse({
        ...base,
        controlIds: id(1),
        mimeType: "application/x-msdownload",
      }).success,
    ).toBe(false);
    expect(
      EvidenceUploadQuery.parse({ ...base, controlIds: id(1), collectedAt: "2026-10-01" })
        .collectedAt,
    ).toBe("2026-10-01");
    expect(
      EvidenceUploadQuery.safeParse({ ...base, controlIds: id(1), collectedAt: "yesterday" })
        .success,
    ).toBe(false);
  });

  it("a task upload names no controls", () => {
    expect(TaskUploadQuery.parse({ fileName: "a.txt", mimeType: "text/plain" })).toEqual({
      fileName: "a.txt",
      mimeType: "text/plain",
      classification: "internal",
    });
  });

  it("an evidence request needs a title, a description and a nullable due date", () => {
    const body = {
      assigneeId: id(1),
      controlId: id(2),
      title: "Restore test report",
      description: "Line one\nLine two",
      dueDate: null,
    };
    expect(EvidenceRequestInput.parse(body)).toEqual(body);
    expect(EvidenceRequestInput.safeParse({ ...body, title: "" }).success).toBe(false);
    expect(EvidenceRequestInput.safeParse({ ...body, dueDate: "2026-13-01" }).success).toBe(false);
    expect(EvidenceRequestInput.safeParse({ ...body, extra: 1 }).success).toBe(false);
  });
});
