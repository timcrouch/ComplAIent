import { describe, expect, it } from "vitest";
import { libraryMetadata, libraryQuery } from "../lib/library-page";
import { activeFilters, libraryHref } from "../lib/library-url";

describe("libraryQuery", () => {
  it("reads the search from the URL, treating empty values as any", () => {
    expect(
      libraryQuery({ q: "A.8.13", framework: "", review: "unreviewed", category: "" }),
    ).toEqual({ q: "A.8.13", review: "unreviewed" });
    expect(libraryQuery({})).toEqual({ review: "all" });
  });

  it("keeps a framework version key that contains a dot", () => {
    expect(libraryQuery({ framework: "nist-csf-2.0" })).toEqual({
      review: "all",
      framework: "nist-csf-2.0",
    });
  });

  it("reads the in-use filter, dropping anything but true or false", () => {
    expect(libraryQuery({ inUse: "true" })).toEqual({ review: "all", inUse: "true" });
    expect(libraryQuery({ inUse: "false" })).toEqual({ review: "all", inUse: "false" });
    expect(libraryQuery({ inUse: "maybe" })).toEqual({ review: "all" });
  });

  it("drops only the values the contract refuses", () => {
    expect(libraryQuery({ q: ["backup", "x"], category: "nope", review: "maybe" })).toEqual({
      q: "backup",
      review: "all",
    });
    expect(libraryQuery({ q: "x".repeat(201), category: "access" })).toEqual({
      review: "all",
      category: "access",
    });
    expect(libraryQuery({ q: "backup", framework: "gdpr\u0000" })).toEqual({
      q: "backup",
      review: "all",
    });
    expect(libraryQuery({ framework: "x".repeat(101) })).toEqual({ review: "all" });
  });
});

describe("libraryMetadata", () => {
  it("gives each library page its own title", () => {
    expect(libraryMetadata().title).toBe("Controls · ComplAIent ISMS");
    expect(libraryMetadata({ code: "RES-01", title: "Back-ups you can restore" }).title).toBe(
      "RES-01 Back-ups you can restore · Controls · ComplAIent ISMS",
    );
  });
});

describe("libraryHref", () => {
  it("is the bare page when nothing narrows the list", () => {
    expect(libraryHref({})).toBe("/library");
    expect(libraryHref({ q: "  ", review: "all" })).toBe("/library");
  });

  it("keeps the search and every filter together, in a stable order", () => {
    expect(
      libraryHref({
        inUse: "true",
        category: "resilience",
        review: "unreviewed",
        framework: "nist-csf-2.0",
        q: " back up ",
      }),
    ).toBe(
      "/library?q=back+up&framework=nist-csf-2.0&review=unreviewed&category=resilience&inUse=true",
    );
  });

  it("round-trips through libraryQuery", () => {
    const query = { q: "A.8.13", framework: "iso27001-2022", review: "reviewed" } as const;
    const params = Object.fromEntries(new URL(libraryHref(query), "http://x").searchParams);
    expect(libraryQuery(params)).toEqual(query);
  });
});

describe("activeFilters", () => {
  it("lists the filters that narrow the list, never the search", () => {
    expect(activeFilters({ q: "x", review: "all" })).toEqual([]);
    expect(
      activeFilters({ q: "x", framework: "gdpr-2016-679", review: "reviewed", inUse: "false" }),
    ).toEqual(["framework", "review", "inUse"]);
  });
});
