import { ModulesForm } from "../../../../components/setup/modules-form";
import { SetupFrame } from "../../../../components/setup/setup-frame";
import { stepMetadata } from "../../../../lib/setup-metadata";
import { loadSetupPage } from "../../../../lib/setup-page";

export const metadata = stepMetadata("modules");

/**
 * The optional modules, each with a switch. Not a setup step: it is never in `setup.missing`,
 * and only people who manage the organisation reach it (loadSetupPage).
 */
export default async function ModulesPage() {
  const page = await loadSetupPage("/setup/modules");
  if (!page.ok) return page.screen;
  return (
    <SetupFrame current="modules" missing={page.organisation.setup.missing}>
      <ModulesForm enabled={page.organisation.modules} />
    </SetupFrame>
  );
}
