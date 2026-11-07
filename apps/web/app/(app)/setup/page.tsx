import { redirect } from "next/navigation";
import { firstIncompleteStep } from "../../../components/setup/steps";
import { loadSetupPage } from "../../../lib/setup-page";

/** /setup resumes guided setup at the first step the API still reports as missing. */
export default async function SetupPage() {
  const page = await loadSetupPage("/setup");
  if (!page.ok) return page.screen;
  redirect(firstIncompleteStep(page.organisation.setup.missing).path);
}
