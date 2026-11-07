import { describe, expect, it } from "vitest";
import nextConfig from "../next.config";

describe("next.config headers", () => {
  it("forbids framing on every route (clickjacking)", async () => {
    const rules = (await nextConfig.headers?.()) ?? [];
    const all = rules.find((rule) => rule.source === "/:path*");
    expect(all?.headers).toEqual(
      expect.arrayContaining([
        { key: "Content-Security-Policy", value: "frame-ancestors 'none'" },
        { key: "X-Frame-Options", value: "DENY" },
      ]),
    );
  });
});
