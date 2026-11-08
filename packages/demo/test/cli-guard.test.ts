import { describe, expect, it, vi } from "vitest";
import { type GuardInput, confirmRun } from "../src/cli/guard.js";

const input = (over: Partial<GuardInput> = {}): GuardInput => ({
  argv: [],
  nodeEnv: "development",
  isTTY: true,
  ask: vi.fn(() => Promise.resolve("n")),
  ...over,
});

describe("confirmRun (the demo:load / demo:reset guard, #7)", () => {
  it.each(["y", "Y", "yes", " YES "])(
    "runs when the person answers %j on a terminal",
    async (a) => {
      const ask = vi.fn<GuardInput["ask"]>(() => Promise.resolve(a));
      await expect(confirmRun("load", "isms", input({ ask }))).resolves.toBeUndefined();
      expect(ask).toHaveBeenCalledOnce();
      expect(ask.mock.calls[0]).toEqual([expect.stringMatching(/"isms".*\[y\/N\] $/)]);
    },
  );

  it.each(["", "n", "no", "maybe", "yess"])("is cancelled by %j (the default is No)", async (a) => {
    await expect(
      confirmRun("reset", "isms", input({ ask: () => Promise.resolve(a) })),
    ).rejects.toThrow(/Cancelled/);
  });

  it("names what each command deletes in its question", async () => {
    const ask = vi.fn<GuardInput["ask"]>(() => Promise.resolve("y"));
    await confirmRun("load", "isms", input({ ask }));
    await confirmRun("reset", "isms", input({ ask }));
    expect(ask.mock.calls[0]?.[0]).toMatch(/Replace everything in "isms" with the sample data/);
    expect(ask.mock.calls[1]?.[0]).toMatch(/Delete all data and settings in "isms"/);
  });

  it("--yes (or -y) skips the question", async () => {
    for (const flag of ["--yes", "-y"]) {
      const ask = vi.fn<GuardInput["ask"]>(() => Promise.resolve("n"));
      await confirmRun("load", "isms", input({ argv: [flag], ask }));
      expect(ask).not.toHaveBeenCalled();
    }
  });

  it("refuses without --yes when not on a terminal, and asks nothing", async () => {
    const ask = vi.fn<GuardInput["ask"]>(() => Promise.resolve("y"));
    await expect(confirmRun("load", "isms", input({ isTTY: false, ask }))).rejects.toThrow(
      /not an interactive terminal.*--yes/,
    );
    expect(ask).not.toHaveBeenCalled();
    await expect(
      confirmRun("load", "isms", input({ isTTY: false, argv: ["--yes"] })),
    ).resolves.toBeUndefined();
  });

  it("refuses when NODE_ENV=production, even with --yes, unless --allow-production", async () => {
    const ask = vi.fn<GuardInput["ask"]>(() => Promise.resolve("y"));
    for (const argv of [[], ["--yes"]]) {
      await expect(
        confirmRun("reset", "isms", input({ nodeEnv: "production", argv, ask })),
      ).rejects.toThrow(/NODE_ENV=production.*--allow-production/);
    }
    expect(ask).not.toHaveBeenCalled();
    // The override lifts only the production refusal: the question is still asked.
    await confirmRun(
      "reset",
      "isms",
      input({ nodeEnv: "production", argv: ["--allow-production"], ask }),
    );
    expect(ask).toHaveBeenCalledOnce();
    await expect(
      confirmRun(
        "reset",
        "isms",
        input({ nodeEnv: "production", argv: ["--allow-production", "--yes"], isTTY: false }),
      ),
    ).resolves.toBeUndefined();
  });

  it("refuses an unknown option, so a typo never skips the question", async () => {
    const ask = vi.fn<GuardInput["ask"]>(() => Promise.resolve("y"));
    await expect(confirmRun("load", "isms", input({ argv: ["--yse"], ask }))).rejects.toThrow(
      /Unknown option "--yse"/,
    );
    expect(ask).not.toHaveBeenCalled();
  });

  it("ignores the `--` separator pnpm may pass on", async () => {
    const ask = vi.fn<GuardInput["ask"]>(() => Promise.resolve("n"));
    await confirmRun("load", "isms", input({ argv: ["--", "--yes"], ask }));
    expect(ask).not.toHaveBeenCalled();
  });
});
