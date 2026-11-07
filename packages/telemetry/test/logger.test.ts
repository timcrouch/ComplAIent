import { Writable } from "node:stream";
import { describe, expect, it } from "vitest";
import { createLogger } from "../src/index.js";

function capture(): { stream: Writable; output: () => string } {
  let buffer = "";
  const stream = new Writable({
    write(chunk: Buffer, _enc, cb) {
      buffer += chunk.toString();
      cb();
    },
  });
  return { stream, output: () => buffer };
}

describe("createLogger", () => {
  it("redacts credentials at any depth", () => {
    const sink = capture();
    const log = createLogger({ level: "info", service: "test" }, sink.stream);
    log.info(
      {
        req: { headers: { authorization: "Bearer abc", cookie: "s=1" } },
        res: { headers: { "set-cookie": "sid=zzz" } },
        nested: { apiKey: "sk-or-1", password: "p", deeper: { token: "tok-1", secret: "sec-1" } },
        a: { accessToken: "at-1", refreshToken: "rt-1", idToken: "it-1" },
      },
      "x",
    );
    const out = sink.output();
    expect(out).not.toMatch(/Bearer abc|s=1|sid=zzz|sk-or-1|"p"|tok-1|sec-1|at-1|rt-1|it-1/);
    expect(out).toContain("[Redacted]");
  });

  it("emits JSON with the service name and honours the level", () => {
    const sink = capture();
    const log = createLogger({ level: "warn", service: "svc" }, sink.stream);
    log.info("hidden");
    log.warn("shown");
    const lines = sink.output().trim().split("\n");
    expect(lines).toHaveLength(1);
    expect(JSON.parse(lines[0] ?? "{}")).toMatchObject({ service: "svc", msg: "shown" });
  });
});

const NAMES = [
  "password",
  "token",
  "clientSecret",
  "client_secret",
  "access_token",
  "id_token",
  "sessionToken",
  "authToken",
  "privateKey",
  "x-api-key",
  "proxy-authorization",
  "PASSWD",
  "ApiKey",
  "api_key",
  "Set-Cookie",
];

describe("recursive scrubbing", () => {
  const log = (obj: object): string => {
    const sink = capture();
    createLogger({ level: "info", service: "t" }, sink.stream).info(obj, "m");
    return sink.output();
  };

  it.each(NAMES)("redacts %s at root level and at depth 6", (name) => {
    const root = log({ [name]: "LEAK-ROOT" });
    expect(root).not.toContain("LEAK-ROOT");
    const deep = log({ a: { b: { c: { d: { e: { f: { [name]: "LEAK-DEEP" } } } } } } });
    expect(deep).not.toContain("LEAK-DEEP");
  });

  it("redacts inside arrays and keeps harmless fields", () => {
    const out = log({ items: [{ password: "LEAK-ARR", ok: "visible" }, [{ token: "LEAK-ARR2" }]] });
    expect(out).not.toMatch(/LEAK-ARR/);
    expect(out).toContain("visible");
  });

  it("redacts secrets in an err.cause chain and keeps the stack", () => {
    const inner = Object.assign(new Error("inner"), {
      config: { headers: { authorization: "LEAK-C" } },
    });
    const err = new Error("outer", { cause: inner });
    const out = log({ err, other: { failure: new Error("x", { cause: { token: "LEAK-T" } }) } });
    expect(out).not.toMatch(/LEAK-C|LEAK-T/);
    expect(out).toContain("outer");
    expect(out).toContain("inner");
    expect(out).toContain("stack");
  });

  it("survives circular objects", () => {
    const a: Record<string, unknown> = { name: "a", password: "LEAK-CIRC" };
    a["self"] = a;
    const out = log({ a });
    expect(out).not.toContain("LEAK-CIRC");
    expect(out).toContain("[Circular]");
  });

  it("redacts a whole subtree beyond the depth cap", () => {
    let deep: Record<string, unknown> = { harmless: "LEAK-BEYOND" };
    for (let i = 0; i < 15; i++) deep = { n: deep };
    expect(log({ deep })).not.toContain("LEAK-BEYOND");
  });
});
