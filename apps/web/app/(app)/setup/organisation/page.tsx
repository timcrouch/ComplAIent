import { ProfileForm } from "../../../../components/setup/profile-form";
import { SetupFrame } from "../../../../components/setup/setup-frame";
import { stepMetadata } from "../../../../lib/setup-metadata";
import { loadSetupPage } from "../../../../lib/setup-page";

export const metadata = stepMetadata("organisation");

export default async function OrganisationStepPage() {
  const page = await loadSetupPage("/setup/organisation");
  if (!page.ok) return page.screen;
  const { profile, setup } = page.organisation;
  return (
    <SetupFrame current="organisation" missing={setup.missing}>
      <ProfileForm initial={profile} />
    </SetupFrame>
  );
}
