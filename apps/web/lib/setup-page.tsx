import "server-only";
import { organisationRoutes, type OrganisationResponse } from "@isms/contracts";
import type { ReactElement } from "react";
import { StatusScreen } from "../components/status/status-screen";
import { requireViewer } from "./current-viewer";
import { failureScreen } from "./page-result";
import { callApi } from "./server-api";

type SetupPage =
  { ok: true; organisation: OrganisationResponse } | { ok: false; screen: ReactElement };

/**
 * The start of every setup page: the session check (requireViewer), then the permission to
 * manage the organisation (hiding is presentation; the API refuses the saves anyway), then
 * the organisation as the API reports it. `path` is where sign-in returns to.
 */
export async function loadSetupPage(path: string): Promise<SetupPage> {
  const viewer = await requireViewer();
  if (!viewer.ok) return viewer;
  if (!viewer.me.permissions.includes("organisation.manage")) {
    return { ok: false, screen: <StatusScreen kind="forbidden" retryHref="/" /> };
  }
  const result = await callApi(organisationRoutes.get, {}, { returnTo: path });
  if (!result.ok) return { ok: false, screen: failureScreen(result, path) };
  return { ok: true, organisation: result.data };
}
