import type { OrganisationFrameworkDto } from "@isms/contracts";

/** The library's framework key; its version keys extend it ("eu-ai-act-2024-1689"). */
const FRAMEWORK_KEY = "eu-ai-act";

/** Whether any version of the EU AI Act framework is confirmed for the organisation. */
export function aiActFrameworkInScope(frameworks: readonly OrganisationFrameworkDto[]): boolean {
  return frameworks.some(
    (f) =>
      f.status === "confirmed" &&
      (f.frameworkVersionKey === FRAMEWORK_KEY ||
        f.frameworkVersionKey.startsWith(`${FRAMEWORK_KEY}-`)),
  );
}

/**
 * The overview's hint while the framework is out of scope (turning the module on never adds
 * it, spec §6): a link to Setup → Frameworks for those who may change it, else who to ask.
 */
export function frameworkHintFor(
  frameworks: readonly OrganisationFrameworkDto[] | null,
  canManageOrganisation: boolean,
): "none" | "link" | "ask" {
  if (frameworks === null || aiActFrameworkInScope(frameworks)) return "none";
  return canManageOrganisation ? "link" : "ask";
}
