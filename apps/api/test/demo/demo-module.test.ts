import { describe, expect, it } from "vitest";
import { DemoModule } from "../../src/demo/index.js";

describe("DemoModule.register", () => {
  it("demo mode off: an empty module, so no routes, no ports and no owner connection exist", () => {
    const mod = DemoModule.register(null);
    expect(mod.module).toBe(DemoModule);
    expect(mod.controllers ?? []).toEqual([]);
    expect(mod.providers ?? []).toEqual([]);
    expect(mod.imports ?? []).toEqual([]);
  });
});
