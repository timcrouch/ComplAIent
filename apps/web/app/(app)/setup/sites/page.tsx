import { SetupFrame } from "../../../../components/setup/setup-frame";
import { UnitsForm } from "../../../../components/setup/units-form";
import { countryOptions } from "../../../../lib/countries";
import { stepMetadata } from "../../../../lib/setup-metadata";
import { loadSetupPage } from "../../../../lib/setup-page";

export const metadata = stepMetadata("sites");

export default async function SitesStepPage() {
  const page = await loadSetupPage("/setup/sites");
  if (!page.ok) return page.screen;
  const { sites, departments, setup } = page.organisation;
  return (
    <SetupFrame current="sites" missing={setup.missing}>
      <UnitsForm
        initialSites={sites}
        initialDepartments={departments}
        countries={countryOptions()}
      />
    </SetupFrame>
  );
}
