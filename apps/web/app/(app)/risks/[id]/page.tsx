import {
  organisationRoutes,
  peopleRoutes,
  riskRoutes,
  type ListUsersResponse,
} from "@isms/contracts";
import type { Metadata } from "next";
import { cookies } from "next/headers";
import { notFound } from "next/navigation";
import { createTranslator } from "next-intl";
import { z } from "zod";
import { Entrance } from "../../../../components/motion/entrance";
import type { OwnerCandidate } from "../../../../components/risks/record-section";
import { RiskDetail } from "../../../../components/risks/risk-detail";
import { StatusScreen } from "../../../../components/status/status-screen";
import { requireViewer } from "../../../../lib/current-viewer";
import { env } from "../../../../lib/env";
import { resolveTimeZone, TIME_ZONE_COOKIE } from "../../../../lib/greeting";
import { failureScreen } from "../../../../lib/page-result";
import { callApi } from "../../../../lib/server-api";
import messages from "../../../../messages/index";

const tm = createTranslator({ locale: "en", messages });

export const metadata: Metadata = { title: tm("risks.pageTitle", { app: tm("app.name") }) };

const OWNER_ROLES: ReadonlySet<string> = new Set(["risk_owner", "ciso"]);

/** People who may own a risk (risk_owner or ciso) and where; the API checks the choice. */
function ownerCandidates(users: ListUsersResponse["users"]): OwnerCandidate[] {
  return users.flatMap((u) => {
    const scopes = u.roles.filter((r) => OWNER_ROLES.has(r.role)).map((r) => r.scope);
    return scopes.length > 0 ? [{ id: u.id, displayName: u.displayName, scopes }] : [];
  });
}

type RiskPageProps = { params: Promise<{ id: string }> };

/** One risk for review: record, assessment, controls, treatment, evidence, approval, history. */
export default async function RiskPage({ params }: RiskPageProps) {
  const viewer = await requireViewer();
  if (!viewer.ok) return viewer.screen;
  const { permissions } = viewer.me;
  if (!permissions.includes("risks.read")) {
    return <StatusScreen kind="forbidden" retryHref="/" />;
  }
  const { id } = await params;
  if (!z.uuid().safeParse(id).success) notFound();
  const path = `/risks/${id}`;

  const mayListPeople = permissions.includes("users.list");
  const [risk, organisation, users] = await Promise.all([
    callApi(riskRoutes.get, { params: { id } }, { returnTo: path }),
    callApi(organisationRoutes.get, {}, { returnTo: path }),
    mayListPeople ? callApi(peopleRoutes.listUsers, {}, { returnTo: path }) : null,
  ]);
  if (!risk.ok) return failureScreen(risk, path);
  if (!organisation.ok) return failureScreen(organisation, path);

  const org = organisation.data;
  const timeZone = resolveTimeZone((await cookies()).get(TIME_ZONE_COOKIE)?.value);
  return (
    <Entrance className="mx-auto w-full max-w-[880px]">
      <RiskDetail
        initial={risk.data}
        scale={org.riskScale ?? org.defaultRiskScale}
        sites={org.sites.map(({ id: siteId, name }) => ({ id: siteId, name }))}
        departments={org.departments}
        // Without the people list the owner is shown, not edited.
        owners={users?.ok ? ownerCandidates(users.data.users) : null}
        canSearchLibrary={permissions.includes("library.read")}
        timeZone={timeZone}
        // Anyone who has signed in can be asked for evidence; the API checks the person.
        people={
          users?.ok
            ? users.data.users.map(({ id: userId, displayName }) => ({ id: userId, displayName }))
            : null
        }
        evidenceMaxBytes={env().EVIDENCE_MAX_BYTES}
      />
    </Entrance>
  );
}
