import type { OrganisationFrameworkDto } from "@isms/contracts";

/** An AI suggestion awaiting the person's choice: which version, and why the AI thinks so. */
export type FrameworkSuggestion = { frameworkVersionId: string; reasoning: string | null };

/** The rows the API holds as open suggestions (never a confirmed one). Server and client. */
export function openSuggestions(rows: readonly OrganisationFrameworkDto[]): FrameworkSuggestion[] {
  return rows
    .filter((r) => r.status === "suggested")
    .map(({ frameworkVersionId, reasoning }) => ({ frameworkVersionId, reasoning }));
}
