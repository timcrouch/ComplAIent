import { describe, expect, it } from "vitest";
import { createMockProvider } from "../src/mock-provider.js";
import { ProviderError } from "../src/provider.js";
import { REQUEST } from "./helpers.js";

describe("mock provider", () => {
  it("is deterministic and lists one test model", async () => {
    const mock = createMockProvider();
    expect(mock.name).toBe("mock");
    expect(mock.routing).toMatchObject({ zdr: true, dataCollection: "deny" });
    expect(await mock.listModels()).toEqual([{ id: "mock/isms-test", name: "Test model" }]);
  });

  it("answers the connection test", async () => {
    const result = await createMockProvider().complete(REQUEST);
    expect(result).toEqual({ content: '{"ok":true}', model: "vendor/model-a", provider: "mock" });
  });

  it("[[mock:invalid]] returns non-JSON every time", async () => {
    const mock = createMockProvider();
    const request = {
      ...REQUEST,
      messages: [{ role: "user" as const, content: "x [[mock:invalid]] y" }],
    };
    for (let i = 0; i < 3; i++) {
      const { content } = await mock.complete(request);
      expect(() => JSON.parse(content) as unknown).toThrow();
    }
  });

  it("[[mock:auth]] throws ProviderError auth", async () => {
    const request = { ...REQUEST, messages: [{ role: "user" as const, content: "[[mock:auth]]" }] };
    await expect(createMockProvider().complete(request)).rejects.toMatchObject({
      name: "ProviderError",
      kind: "auth",
    });
  });

  it("an unknown schema is unavailable", async () => {
    await expect(
      createMockProvider().complete({ ...REQUEST, schemaName: "nope" }),
    ).rejects.toBeInstanceOf(ProviderError);
  });

  it("an inherited property name such as toString is unavailable like an unknown schema", async () => {
    for (const schemaName of ["toString", "constructor", "__proto__", "hasOwnProperty"]) {
      await expect(createMockProvider().complete({ ...REQUEST, schemaName })).rejects.toMatchObject(
        {
          name: "ProviderError",
          kind: "unavailable",
        },
      );
    }
  });

  it("a script decides the reply, or throws its ProviderError", async () => {
    const scripted = createMockProvider({ script: (r) => `{"echo":"${r.schemaName}"}` });
    expect((await scripted.complete(REQUEST)).content).toBe('{"echo":"connection_test"}');
    const failing = createMockProvider({ script: () => new ProviderError("noEndpoint") });
    await expect(failing.complete(REQUEST)).rejects.toMatchObject({ kind: "noEndpoint" });
  });
});
