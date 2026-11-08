import { aiActRoutes, organisationRoutes } from "@isms/contracts";
import { Entrance } from "../../../components/motion/entrance";
import { AiActOverview } from "../../../components/ai-act/overview";
import { aiActMetadata, loadAiActPage } from "../../../lib/ai-act-page";
import { frameworkHintFor } from "../../../lib/ai-act-scope";
import { failureScreen } from "../../../lib/page-result";
import { callApi } from "../../../lib/server-api";

const PATH = "/ai-act";

export const metadata = aiActMetadata("overview");

/** The EU AI Act overview: counts, the framework hint and the AI system register. */
export default async function AiActPage() {
  const page = await loadAiActPage("aiact.read");
  if (!page.ok) return page.screen;
  const { permissions } = page.me;
  const [systems, organisation] = await Promise.all([
    callApi(aiActRoutes.listSystems, {}, { returnTo: PATH }),
    callApi(organisationRoutes.get, {}, { returnTo: PATH }),
  ]);
  if (!systems.ok) return failureScreen(systems, PATH);
  // The hint is a convenience: an unreadable organisation only leaves it out.
  const frameworks = organisation.ok ? organisation.data.frameworks : null;
  return (
    <Entrance className="mx-auto w-full max-w-[960px]">
      <AiActOverview
        systems={systems.data.systems}
        canManage={permissions.includes("aiact.manage")}
        frameworkHint={frameworkHintFor(frameworks, permissions.includes("organisation.manage"))}
      />
    </Entrance>
  );
}
