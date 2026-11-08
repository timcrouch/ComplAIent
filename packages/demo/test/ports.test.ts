import { describe, expect, it } from "vitest";
import { DemoPortsError, tryEach } from "../src/ports.js";

describe("tryEach (#7: the ports never stop at the first failure)", () => {
  it("runs every step, in order, and returns each failure with its reason", async () => {
    const ran: string[] = [];
    const step = (name: string, outcome: () => Promise<void> = () => Promise.resolve()) =>
      [
        name,
        () => {
          ran.push(name);
          return outcome();
        },
      ] as const;
    const failures = await tryEach([
      step("a"),
      step("b", () => Promise.reject(new Error("b broke"))),
      step("c"),
      // eslint-disable-next-line @typescript-eslint/prefer-promise-reject-errors -- a non-Error reason
      step("d", () => Promise.reject("not an Error")),
    ]);
    expect(ran).toEqual(["a", "b", "c", "d"]);
    expect(failures).toEqual([
      { step: "b", message: "b broke" },
      { step: "d", message: "not an Error" },
    ]);
  });

  it("returns no failures when every step succeeds", async () => {
    expect(await tryEach([["a", () => Promise.resolve(1)]])).toEqual([]);
  });
});

describe("DemoPortsError", () => {
  it("says what was done and lists every failed step", () => {
    const error = new DemoPortsError("The reset was done", [
      { step: "wipeEvidence", message: "s3 down" },
      { step: "drainQueues", message: "redis down" },
    ]);
    expect(error.message).toBe(
      "The reset was done, but 2 follow-up steps failed: wipeEvidence: s3 down; drainQueues: redis down",
    );
    expect(new DemoPortsError("Done", [{ step: "x", message: "y" }]).message).toBe(
      "Done, but 1 follow-up step failed: x: y",
    );
  });
});
