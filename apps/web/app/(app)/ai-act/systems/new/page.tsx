import { getTranslations } from "next-intl/server";
import { ModuleHeader } from "../../../../../components/ai-act/module-header";
import { SystemForm } from "../../../../../components/ai-act/system-form";
import { Entrance } from "../../../../../components/motion/entrance";
import { aiActMetadata, loadAiActPage, loadFormOptions } from "../../../../../lib/ai-act-page";

const PATH = "/ai-act/systems/new";

export const metadata = aiActMetadata("new");

/** Add an AI system to the register; the questionnaire follows. */
export default async function NewAiSystemPage() {
  const page = await loadAiActPage("aiact.manage");
  if (!page.ok) return page.screen;
  const form = await loadFormOptions(page.me, PATH);
  if (!form.ok) return form.screen;
  const t = await getTranslations("aiAct");
  return (
    <Entrance className="mx-auto flex w-full max-w-[880px] flex-col gap-6">
      <ModuleHeader
        title={t("form.newTitle")}
        intro={t("form.newIntro")}
        back={{ href: "/ai-act", label: t("back") }}
      />
      <SystemForm
        initial={null}
        people={form.options.people}
        departments={form.options.departments}
        defaultOwnerId={page.me.id}
      />
    </Entrance>
  );
}
