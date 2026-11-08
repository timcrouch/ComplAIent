import { aiActRoutes } from "@isms/contracts";
import { ClassifyWizard } from "../../../../../../components/ai-act/classify-wizard";
import { Entrance } from "../../../../../../components/motion/entrance";
import {
  aiActMetadata,
  loadAiActPage,
  systemIdOrNotFound,
} from "../../../../../../lib/ai-act-page";
import { failureScreen } from "../../../../../../lib/page-result";
import { callApi } from "../../../../../../lib/server-api";

export const metadata = aiActMetadata("wizard");

type Props = { params: Promise<{ id: string }> };

/** The classification questionnaire for one system; the server decides the class. */
export default async function ClassifyAiSystemPage({ params }: Props) {
  const page = await loadAiActPage("aiact.manage");
  if (!page.ok) return page.screen;
  const id = systemIdOrNotFound((await params).id);
  const path = `/ai-act/systems/${id}/classify`;
  const system = await callApi(aiActRoutes.getSystem, { params: { id } }, { returnTo: path });
  if (!system.ok) return failureScreen(system, path);
  return (
    <Entrance className="mx-auto w-full max-w-[880px]">
      <ClassifyWizard system={system.data} canDraft={system.data.canDraftClassification} />
    </Entrance>
  );
}
