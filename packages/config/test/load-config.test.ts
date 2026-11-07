import { afterEach, describe, expect, it, vi } from "vitest";
import {
  ConfigError,
  apiConfig,
  bootstrapConfig,
  databaseOwnerConfig,
  databaseTestConfig,
  formatConfigErrorAndExit,
  loadConfig,
  oidcConfig,
  redisConfig,
  telemetryConfig,
  webConfig,
  workerConfig,
} from "../src/index.js";

function catchError(fn: () => unknown): Error {
  try {
    fn();
  } catch (e) {
    return e as Error;
  }
  throw new Error("expected throw");
}

describe("loadConfig", () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("returns typed values", () => {
    expect(loadConfig(redisConfig, { REDIS_URL: "redis://localhost:6379" })).toEqual({
      REDIS_URL: "redis://localhost:6379",
    });
  });

  it("names missing and invalid variables without printing values", () => {
    const env = { SESSION_SECRET: "short-secret-value", WEB_BASE_URL: "x" };
    const err = catchError(() => loadConfig(webConfig, env));
    expect(err).toBeInstanceOf(ConfigError);
    expect(err.message).toContain("SESSION_SECRET");
    expect(err.message).toContain("API_BASE_URL");
    expect(err.message).toContain("WEB_BASE_URL");
    expect(err.message).not.toContain("short-secret-value");
  });

  it("reports every problem at once as VARNAME: problem", () => {
    const err = catchError(() => loadConfig(webConfig, { SESSION_SECRET: "short-secret-value" }));
    const lines = err.message
      .split("\n")
      .map((l) => l.trim())
      .filter((l) => /^[A-Z_]+: /.test(l));
    expect(lines.map((l) => l.split(":")[0]).sort()).toEqual([
      "API_BASE_URL",
      "SESSION_SECRET",
      "WEB_BASE_URL",
    ]);
  });

  it("never leaks values for enum, email and url failures", () => {
    const e1 = catchError(() => loadConfig(telemetryConfig, { LOG_LEVEL: "sekret-level" }));
    expect(e1.message).toContain("LOG_LEVEL");
    expect(e1.message).not.toContain("sekret-level");
    const e2 = catchError(() =>
      loadConfig(bootstrapConfig, { BOOTSTRAP_ADMIN_EMAIL: "not-an-email-sekret" }),
    );
    expect(e2.message).toContain("BOOTSTRAP_ADMIN_EMAIL");
    expect(e2.message).not.toContain("sekret");
    const e3 = catchError(() =>
      loadConfig(oidcConfig, { OIDC_ISSUER_URL: "sekret-not-url", OIDC_CLIENT_SECRET: "" }),
    );
    expect(e3.message).toContain("OIDC_ISSUER_URL");
    expect(e3.message).toContain("OIDC_CLIENT_SECRET");
    expect(e3.message).not.toContain("sekret");
  });

  it("applies defaults and optional fields", () => {
    expect(loadConfig(telemetryConfig, {})).toEqual({ LOG_LEVEL: "info", METRICS_PORT: 9464 });
    expect(loadConfig(bootstrapConfig, {})).toEqual({});
  });
});

describe("formatConfigErrorAndExit", () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("writes the message to stderr and exits with 78", () => {
    const write = vi.spyOn(process.stderr, "write").mockImplementation(() => true);
    const exit = vi.spyOn(process, "exit").mockImplementation((() => undefined) as never);
    formatConfigErrorAndExit(new ConfigError(["REDIS_URL: is required"]));
    expect(write).toHaveBeenCalledOnce();
    expect(String(write.mock.calls[0]?.[0])).toContain("REDIS_URL: is required");
    expect(exit).toHaveBeenCalledWith(78);
  });
});

describe("database owner and test configs", () => {
  it("requires DATABASE_OWNER_URL", () => {
    expect(() => loadConfig(databaseOwnerConfig, {})).toThrow(/DATABASE_OWNER_URL: is required/);
  });

  it("requires both test URLs", () => {
    const err = catchError(() => loadConfig(databaseTestConfig, {}));
    expect(err.message).toContain("DATABASE_TEST_URL");
    expect(err.message).toContain("DATABASE_OWNER_TEST_URL");
  });
});

describe("telemetry and api ports", () => {
  it("defaults METRICS_PORT to 9464 and API_PORT to 4000", () => {
    expect(loadConfig(telemetryConfig, {}).METRICS_PORT).toBe(9464);
    expect(loadConfig(apiConfig, {}).API_PORT).toBe(4000);
  });

  it("coerces and range-checks ports", () => {
    expect(loadConfig(apiConfig, { API_PORT: "4100" }).API_PORT).toBe(4100);
    expect(() => loadConfig(telemetryConfig, { METRICS_PORT: "70000" })).toThrow(/METRICS_PORT/);
  });
});

describe("api rate limiting and proxy config", () => {
  it("defaults to 120 per minute and no trusted proxy", () => {
    const config = loadConfig(apiConfig, {});
    expect(config.RATE_LIMIT_PER_MINUTE).toBe(120);
    expect(config.TRUST_PROXY).toBe(false);
  });

  it("parses TRUST_PROXY as false or a proxy hop count (1-10)", () => {
    expect(loadConfig(apiConfig, { TRUST_PROXY: "false" }).TRUST_PROXY).toBe(false);
    expect(loadConfig(apiConfig, { TRUST_PROXY: "2" }).TRUST_PROXY).toBe(2);
    expect(() => loadConfig(apiConfig, { TRUST_PROXY: "true" })).toThrow(/hop count/);
    for (const bad of ["0", "11", "yes", "1.5", "-1"]) {
      expect(() => loadConfig(apiConfig, { TRUST_PROXY: bad })).toThrow(/TRUST_PROXY/);
    }
    expect(() => loadConfig(apiConfig, { RATE_LIMIT_PER_MINUTE: "0" })).toThrow(
      /RATE_LIMIT_PER_MINUTE/,
    );
  });
});

describe("api per-IP throttle config", () => {
  it("defaults to 600 per minute and no trusted IPs", () => {
    const config = loadConfig(apiConfig, {});
    expect(config.RATE_LIMIT_PER_IP_PER_MINUTE).toBe(600);
    expect(config.THROTTLE_TRUSTED_IPS).toEqual([]);
  });

  it("rejects a per-IP limit below 1", () => {
    expect(() => loadConfig(apiConfig, { RATE_LIMIT_PER_IP_PER_MINUTE: "0" })).toThrow(
      /RATE_LIMIT_PER_IP_PER_MINUTE/,
    );
  });

  it("parses THROTTLE_TRUSTED_IPS, trimming and dropping empties", () => {
    const config = loadConfig(apiConfig, { THROTTLE_TRUSTED_IPS: " 10.0.0.1, ,::1,," });
    expect(config.THROTTLE_TRUSTED_IPS).toEqual(["10.0.0.1", "::1"]);
  });

  it("rejects an invalid trusted IP", () => {
    expect(() => loadConfig(apiConfig, { THROTTLE_TRUSTED_IPS: "10.0.0.1,not-an-ip" })).toThrow(
      /THROTTLE_TRUSTED_IPS/,
    );
  });
});

describe("workerConfig", () => {
  it("defaults health to 9465 and metrics to 9466", () => {
    expect(loadConfig(workerConfig, {})).toEqual({
      WORKER_HEALTH_PORT: 9465,
      WORKER_METRICS_PORT: 9466,
    });
  });

  it("coerces and validates ports", () => {
    expect(loadConfig(workerConfig, { WORKER_HEALTH_PORT: "9500" }).WORKER_HEALTH_PORT).toBe(9500);
    expect(() => loadConfig(workerConfig, { WORKER_METRICS_PORT: "0" })).toThrow(
      /WORKER_METRICS_PORT/,
    );
  });
});
