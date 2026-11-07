import { describe, expect, it } from "vitest";
import { ipTracker, normaliseIp } from "../src/platform/caller-throttler.guard.js";

describe("normaliseIp", () => {
  it("strips the IPv4-mapped IPv6 prefix", () => {
    expect(normaliseIp("::ffff:10.0.0.1")).toBe("10.0.0.1");
    expect(normaliseIp("::FFFF:10.0.0.1")).toBe("10.0.0.1");
  });

  it("lower-cases IPv6 and leaves other addresses unchanged", () => {
    expect(normaliseIp("2001:DB8::A")).toBe("2001:db8::a");
    expect(normaliseIp("::1")).toBe("::1");
    expect(normaliseIp("10.0.0.1")).toBe("10.0.0.1");
  });
});

describe("ipTracker", () => {
  it("keys on the normalised address", () => {
    expect(ipTracker({ ip: "::ffff:10.0.0.1" })).toBe("ip:10.0.0.1");
    expect(ipTracker({})).toBe("ip:unknown");
  });
});
