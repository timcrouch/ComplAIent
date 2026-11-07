import type { ControlListQuery } from "@isms/contracts";

/** The filters on the Controls page, in the order the URL and the filter bar list them. */
export const LIBRARY_FILTERS = ["framework", "review", "category", "inUse"] as const;
export type LibraryFilter = (typeof LIBRARY_FILTERS)[number];

/**
 * The URL of a library view: the search and every filter together, so a view can be shared,
 * bookmarked and reloaded. "Any" values stay out of the URL. `libraryQuery` reads it back.
 * Kept apart from library-page.ts so client components don't bundle the message files.
 */
export function libraryHref(query: Partial<ControlListQuery>): string {
  const params = new URLSearchParams();
  const q = query.q?.trim();
  if (q) params.set("q", q);
  for (const key of LIBRARY_FILTERS) {
    const value = query[key];
    if (value && !(key === "review" && value === "all")) params.set(key, value);
  }
  const search = params.toString();
  return search ? `/library?${search}` : "/library";
}

/** The filters that narrow the list (the search is not one of them). */
export function activeFilters(query: Partial<ControlListQuery>): LibraryFilter[] {
  return LIBRARY_FILTERS.filter((key) => query[key] && !(key === "review" && query[key] === "all"));
}
