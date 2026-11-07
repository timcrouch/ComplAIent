import type { Server } from "node:http";
import { Writable } from "node:stream";
import { Test } from "@nestjs/testing";
import request from "supertest";
import { describe, expect, it, vi } from "vitest";
import { PlatformModule, configureApp } from "../src/platform/index.js";

// Own file: nestjs-pino keeps one process-wide root logger, so a log destination can only
// be chosen by the first application built in a test file.
describe("request logging", () => {
  it("never writes Authorization, Cookie or API key values to the request log", async () => {
    let output = "";
    const destination = new Writable({
      write(chunk: Buffer, _enc, cb) {
        output += chunk.toString();
        cb();
      },
    });
    const moduleRef = await Test.createTestingModule({
      imports: [
        PlatformModule.forRoot({
          logLevel: "info",
          service: "isms-api-test",
          rateLimitPerMinute: 1000,
          rateLimitPerIpPerMinute: 1000,
          throttleTrustedIps: [],
          logDestination: destination,
        }),
      ],
    }).compile();
    const app = moduleRef.createNestApplication({ bufferLogs: true });
    configureApp(app, { trustProxy: false });
    await app.init();
    try {
      await request(app.getHttpServer() as Server)
        .get("/api/v1/nope")
        .set("Authorization", "Bearer LEAK-AUTH")
        .set("Cookie", "sid=LEAK-COOKIE")
        .set("X-Api-Key", "LEAK-APIKEY");
      // The request log is written when the response finishes, just after the client sees it.
      await vi.waitFor(() => {
        expect(output).toContain("request completed");
      });
      expect(output).not.toMatch(/LEAK-/);
      expect(output).toContain("[Redacted]");
    } finally {
      await app.close();
    }
  });
});
