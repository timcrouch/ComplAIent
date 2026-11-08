import "server-only";
import {
  organisationRoutes,
  peopleRoutes,
  type MeResponse,
  type Permission,
  type PersonRef,
} from "@isms/contracts";
import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { createTranslator } from "next-intl";
import type { ReactElement } from "react";
import { z } from "zod";
import { StatusScreen } from "../components/status/status-screen";
import messages from "../messages/index";
import { requireViewer } from "./current-viewer";
import { failureScreen } from "./page-result";
import { callApi } from "./server-api";

type AiActPage = { ok: true; me: MeResponse } | { ok: false; screen: ReactElement };

/**
 * The start of every EU AI Act page, in the API's order: the session (requireViewer), then
 * the module (off means the pages do not exist: 404, never 403), then the permission. Hiding
 * is presentation; the API answers 404 and 403 itself.
 */
export async function loadAiActPage(permission: Permission): Promise<AiActPage> {
  const viewer = await requireViewer();
  if (!viewer.ok) return viewer;
  if (!viewer.me.modules.includes("eu_ai_act")) notFound();
  if (!viewer.me.permissions.includes(permission)) {
    return { ok: false, screen: <StatusScreen kind="forbidden" retryHref="/" /> };
  }
  return { ok: true, me: viewer.me };
}

/** A system id from the URL; anything that is not a UUID names nothing (404). */
export function systemIdOrNotFound(id: string): string {
  if (!z.uuid().safeParse(id).success) notFound();
  return id;
}

/** "Classify · EU AI Act · ComplAIent ISMS". */
export function aiActMetadata(page: "overview" | "new" | "edit" | "detail" | "wizard"): Metadata {
  const t = createTranslator({ locale: "en", messages });
  const name = {
    overview: t("aiAct.overview.pageTitle"),
    new: t("aiAct.form.newTitle"),
    edit: t("aiAct.form.editPageTitle"),
    detail: t("aiAct.detail.pageTitle"),
    wizard: t("aiAct.wizard.pageTitle"),
  }[page];
  return { title: t("aiAct.pageTitle", { page: name, app: t("app.name") }) };
}

export type FormOptions = {
  people: PersonRef[];
  departments: { id: string; name: string }[];
};

/**
 * The owner and department choices for the profile form. Without users.list (a risk owner)
 * the viewer can still choose themself; the API checks that the owner is a user.
 */
export async function loadFormOptions(
  me: MeResponse,
  path: string,
): Promise<{ ok: true; options: FormOptions } | { ok: false; screen: ReactElement }> {
  const [organisation, users] = await Promise.all([
    callApi(organisationRoutes.get, {}, { returnTo: path }),
    me.permissions.includes("users.list")
      ? callApi(peopleRoutes.listUsers, {}, { returnTo: path })
      : null,
  ]);
  if (!organisation.ok) return { ok: false, screen: failureScreen(organisation, path) };
  const self = { id: me.id, displayName: me.displayName };
  const people = users?.ok
    ? users.data.users.map(({ id, displayName }) => ({ id, displayName }))
    : [self];
  return {
    ok: true,
    options: {
      people,
      departments: organisation.data.departments.map(({ id, name }) => ({ id, name })),
    },
  };
}
