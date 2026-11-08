import { aiActRoutes } from "@isms/contracts";
import { getTranslations } from "next-intl/server";
import { ModuleHeader } from "../../../../../../components/ai-act/module-header";
import { SystemForm } from "../../../../../../components/ai-act/system-form";
import { Entrance } from "../../../../../../components/motion/entrance";
import {
  aiActMetadata,
  loadAiActPage,
  loadFormOptions,
  systemIdOrNotFound,
} from "../../../../../../lib/ai-act-page";
import { failureScreen } from "../../../../../../lib/page-result";
import { callApi } from "../../../../../../lib/server-api";

export const metadata = aiActMetadata("edit");

type Props = { params: Promise<{ id: string }> };

/** Edit an AI system's profile. */
export default async function EditAiSystemPage({ params }: Props) {
  const page = await loadAiActPage("aiact.manage");
  if (!page.ok) return page.screen;
  const id = systemIdOrNotFound((await params).id);
  const path = `/ai-act/systems/${id}/edit`;
  const [system, form] = await Promise.all([
    callApi(aiActRoutes.getSystem, { params: { id } }, { returnTo: path }),
    loadFormOptions(page.me, path),
  ]);
  if (!system.ok) return failureScreen(system, path);
  if (!form.ok) return form.screen;
  const t = await getTranslations("aiAct");
  return (
    <Entrance className="mx-auto flex w-full max-w-[880px] flex-col gap-6">
      <ModuleHeader
        title={t("form.editTitle", { name: system.data.name })}
        intro={t("form.editIntro")}
        back={{
          href: `/ai-act/systems/${id}`,
          label: t("backToSystem", { name: system.data.name }),
        }}
      />
      <SystemForm
        initial={system.data}
        people={form.options.people}
        departments={form.options.departments}
        defaultOwnerId={page.me.id}
      />
    </Entrance>
  );
}
