import { aiSettingsRoutes, libraryRoutes } from "@isms/contracts";
import { FrameworksForm } from "../../../../components/setup/frameworks-form";
import { SetupFrame } from "../../../../components/setup/setup-frame";
import { frameworkSuggestionsReady } from "../../../../lib/ai-availability";
import { requireViewer } from "../../../../lib/current-viewer";
import { openSuggestions } from "../../../../lib/framework-suggestions";
import { failureScreen } from "../../../../lib/page-result";
import { callApi } from "../../../../lib/server-api";
import { stepMetadata } from "../../../../lib/setup-metadata";
import { loadSetupPage } from "../../../../lib/setup-page";

export const metadata = stepMetadata("frameworks");

const PATH = "/setup/frameworks";

export default async function FrameworksStepPage() {
  const page = await loadSetupPage(PATH);
  if (!page.ok) return page.screen;
  // The viewer is cached for the request: loadSetupPage has already resolved it.
  const viewer = await requireViewer();
  const readsAi = viewer.ok && viewer.me.permissions.includes("settings.ai.manage");
  const [library, ai] = await Promise.all([
    callApi(libraryRoutes.listFrameworks, {}, { returnTo: PATH }),
    readsAi ? callApi(aiSettingsRoutes.get, {}, { returnTo: PATH }) : null,
  ]);
  if (!library.ok) return failureScreen(library, PATH);
  // Unknown AI settings are not a failure: frameworks are always chosen by hand too.
  const aiAvailable = ai?.ok === true && frameworkSuggestionsReady(ai.data);
  const { frameworks, setup } = page.organisation;
  return (
    <SetupFrame current="frameworks" missing={setup.missing}>
      <FrameworksForm
        frameworks={library.data.frameworks}
        confirmedIds={frameworks
          .filter((f) => f.status === "confirmed")
          .map((f) => f.frameworkVersionId)}
        suggestions={openSuggestions(frameworks)}
        aiAvailable={aiAvailable}
      />
    </SetupFrame>
  );
}
