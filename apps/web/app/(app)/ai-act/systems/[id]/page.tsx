import { aiActRoutes, riskRoutes } from "@isms/contracts";
import { cookies } from "next/headers";
import { SystemDetail } from "../../../../../components/ai-act/system-detail";
import { Entrance } from "../../../../../components/motion/entrance";
import { aiActMetadata, loadAiActPage, systemIdOrNotFound } from "../../../../../lib/ai-act-page";
import { resolveTimeZone, TIME_ZONE_COOKIE } from "../../../../../lib/greeting";
import { failureScreen } from "../../../../../lib/page-result";
import { callApi } from "../../../../../lib/server-api";

export const metadata = aiActMetadata("detail");

type Props = { params: Promise<{ id: string }> };

/** One AI system: profile, classification, obligations and linked risks. */
export default async function AiSystemPage({ params }: Props) {
  const page = await loadAiActPage("aiact.read");
  if (!page.ok) return page.screen;
  const id = systemIdOrNotFound((await params).id);
  const path = `/ai-act/systems/${id}`;
  const { permissions } = page.me;
  const canManage = permissions.includes("aiact.manage");
  const canReadRisks = permissions.includes("risks.read");
  const [system, risks] = await Promise.all([
    callApi(aiActRoutes.getSystem, { params: { id } }, { returnTo: path }),
    // The picker's choices: the newest 100 risks the viewer may see (the API's page limit).
    canManage && canReadRisks
      ? callApi(riskRoutes.list, { query: { filter: "all", limit: 100 } }, { returnTo: path })
      : null,
  ]);
  if (!system.ok) return failureScreen(system, path);
  const timeZone = resolveTimeZone((await cookies()).get(TIME_ZONE_COOKIE)?.value);
  return (
    <Entrance className="mx-auto w-full max-w-[880px]">
      <SystemDetail
        initial={system.data}
        canManage={canManage}
        canReadRisks={canReadRisks}
        // Without the list, links are shown and can be removed, but none can be added.
        riskOptions={
          risks?.ok
            ? risks.data.items.map(({ id: riskId, reference, title }) => ({
                id: riskId,
                reference,
                title,
              }))
            : null
        }
        timeZone={timeZone}
      />
    </Entrance>
  );
}
