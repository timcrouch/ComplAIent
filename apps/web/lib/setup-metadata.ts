import type { Metadata } from "next";
import { createTranslator } from "next-intl";
import messages from "../messages/index";
import type { FramePageKey } from "../components/setup/steps";

/**
 * A setup page's own title ("Where you work · Set up your organisation · ComplAIent ISMS"). Next's
 * route announcer reads the new title after a client navigation, so each step is announced.
 */
export function stepMetadata(step: FramePageKey): Metadata {
  const t = createTranslator({ locale: "en", messages });
  return {
    title: t("setup.pageTitle", { step: t(`setup.${step}.title`), app: t("app.name") }),
  };
}
