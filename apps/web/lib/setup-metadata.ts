import type { Metadata } from "next";
import { createTranslator } from "next-intl";
import messages from "../messages/index";
import type { FrameStepKey } from "../components/setup/steps";

/**
 * A setup step's own page title ("Where you work · Set up your organisation · ComplAIent ISMS"). Next's
 * route announcer reads the new title after a client navigation, so each step is announced.
 */
export function stepMetadata(step: FrameStepKey): Metadata {
  const t = createTranslator({ locale: "en", messages });
  return {
    title: t("setup.pageTitle", { step: t(`setup.${step}.title`), app: t("app.name") }),
  };
}
