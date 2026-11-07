import { describe, expect, it } from "vitest";
import { FrameworksInput, ProfileInput, RiskScaleInput, UnitsInput } from "../src/index.js";

const paths = (result: { success: boolean; error?: { issues: { path: PropertyKey[] }[] } }) =>
  result.error?.issues.map((i) => i.path.join(".")) ?? [];

describe("organisation inputs", () => {
  const site = (name: string, countryCode = "LV") => ({ name, countryCode });

  it("trims names and needs at least one site", () => {
    const parsed = UnitsInput.parse({ sites: [site("  Riga  ")], departments: [] });
    expect(parsed.sites[0]?.name).toBe("Riga");
    expect(paths(UnitsInput.safeParse({ sites: [], departments: [] }))).toEqual(["sites"]);
    expect(paths(UnitsInput.safeParse({ sites: [site("   ")], departments: [] }))).toEqual([
      "sites.0.name",
    ]);
  });

  it("names must be unique ignoring case and surrounding spaces, per list", () => {
    const result = UnitsInput.safeParse({
      sites: [site(" Riga "), site("Berlin", "DE"), site("riga")],
      departments: [{ name: "IT" }, { name: "it " }, { name: "Riga" }],
    });
    expect(paths(result)).toEqual(["sites.2.name", "departments.1.name"]);
  });

  it("rejects whitespace other than plain spaces, which the database would not trim", () => {
    for (const name of ["Riga\t", "\nRiga", "Ri ga", "Riga ", "Ri\u0007ga", "Riga\u200b"]) {
      const result = UnitsInput.safeParse({ sites: [site(name)], departments: [{ name }] });
      expect(paths(result), JSON.stringify(name)).toEqual(["sites.0.name", "departments.0.name"]);
    }
    expect(UnitsInput.safeParse({ sites: [site("Rīga Old Town")], departments: [] }).success).toBe(
      true,
    );
  });

  it("accepts the zero-width joiners real names need, but still refuses other invisibles", () => {
    const coder = "\u{1F469}\u200d\u{1F4BB} Engineering"; // 👩‍💻, joined by U+200D
    const persian = "\u0645\u06cc\u200c\u062e\u0648\u0627\u0647\u0645"; // with U+200C
    for (const name of [coder, persian]) {
      const units = UnitsInput.safeParse({ sites: [site(name)], departments: [{ name }] });
      expect(units.success, JSON.stringify(name)).toBe(true);
      const profile = { name, description: name, approximateHeadcount: 10 };
      expect(ProfileInput.safeParse(profile).success, JSON.stringify(name)).toBe(true);
    }
    for (const name of ["Riga\u200b", "Riga\u200e", "Riga\u200f"]) {
      const units = UnitsInput.safeParse({ sites: [site(name)], departments: [] });
      expect(paths(units), JSON.stringify(name)).toEqual(["sites.0.name"]);
    }
  });

  it("profile text refuses control characters; the description may span lines", () => {
    const profile = { name: "Acme", description: "About us.", approximateHeadcount: 10 };
    const bad = { ...profile, name: "Ac\u0000me", description: "About\u0007 us." };
    expect(paths(ProfileInput.safeParse(bad))).toEqual(["name", "description"]);
    expect(paths(ProfileInput.safeParse({ ...profile, name: "Ac\nme" }))).toEqual(["name"]);
    expect(paths(ProfileInput.safeParse({ ...profile, name: "Ac\u200bme" }))).toEqual(["name"]);
    const multi = { ...profile, description: "Line one.\r\n\tLine two." };
    expect(ProfileInput.safeParse(multi).success).toBe(true);
  });

  it("accepts only assigned country codes in capitals", () => {
    for (const code of ["XX", "UK", "lv", "LVA"]) {
      expect(paths(UnitsInput.safeParse({ sites: [site("Riga", code)], departments: [] }))).toEqual(
        ["sites.0.countryCode"],
      );
    }
  });

  it("is strict, and framework ids are unique", () => {
    expect(UnitsInput.safeParse({ sites: [site("Riga")], departments: [], x: 1 }).success).toBe(
      false,
    );
    const id = "0190a5c4-0000-7000-8000-000000000001";
    expect(paths(FrameworksInput.safeParse({ frameworkVersionIds: [id, id] }))).toEqual([
      "frameworkVersionIds.1",
    ]);
    expect(paths(FrameworksInput.safeParse({ frameworkVersionIds: [] }))).toEqual([
      "frameworkVersionIds",
    ]);
  });

  it("appetite is an integer from 1 to 24", () => {
    for (const appetiteThreshold of [0, 25, 9.5]) {
      expect(RiskScaleInput.safeParse({ appetiteThreshold }).success).toBe(false);
    }
    expect(RiskScaleInput.parse({ appetiteThreshold: 24 })).toEqual({ appetiteThreshold: 24 });
  });
});
