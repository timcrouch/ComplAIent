import { peopleRoutes } from "@isms/contracts";
import { StepLinks } from "../../../../components/setup/form-footer";
import { PeopleList } from "../../../../components/setup/people-list";
import { SetupFrame } from "../../../../components/setup/setup-frame";
import { stepByKey } from "../../../../components/setup/steps";
import { failureScreen } from "../../../../lib/page-result";
import { callApi } from "../../../../lib/server-api";
import { stepMetadata } from "../../../../lib/setup-metadata";
import { loadSetupPage } from "../../../../lib/setup-page";

export const metadata = stepMetadata("people");

const PATH = "/setup/people";

export default async function PeopleStepPage() {
  const page = await loadSetupPage(PATH);
  if (!page.ok) return page.screen;
  const people = await callApi(peopleRoutes.listUsers, {}, { returnTo: PATH });
  if (!people.ok) return failureScreen(people, PATH);
  const { sites, departments, setup } = page.organisation;
  return (
    <SetupFrame current="people" missing={setup.missing}>
      <PeopleList users={people.data.users} sites={sites} departments={departments} />
      <StepLinks backHref={stepByKey("riskAppetite").path} nextHref={stepByKey("review").path} />
    </SetupFrame>
  );
}
