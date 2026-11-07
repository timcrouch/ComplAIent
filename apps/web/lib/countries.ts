import { COUNTRY_CODES } from "@isms/domain";

export type CountryOption = { code: string; name: string };

/**
 * Country choices with English names, sorted by name. Built on the server and passed to the
 * form, so the browser's own (possibly different) region names cannot cause a hydration
 * mismatch.
 */
export function countryOptions(): CountryOption[] {
  const names = new Intl.DisplayNames(["en"], { type: "region" });
  return COUNTRY_CODES.map((code) => ({ code, name: names.of(code) ?? code })).sort((a, b) =>
    a.name.localeCompare(b.name, "en"),
  );
}
