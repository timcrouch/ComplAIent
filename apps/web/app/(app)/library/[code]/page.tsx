import { controlOperationRoutes, libraryRoutes } from "@isms/contracts";
import { CONTROL_CODE_PATTERN } from "@isms/domain";
import type { Metadata } from "next";
import { cookies } from "next/headers";
import { notFound } from "next/navigation";
import { cache } from "react";
import { ControlDetail } from "../../../../components/library/control-detail";
import { StatusScreen } from "../../../../components/status/status-screen";
import { requireViewer } from "../../../../lib/current-viewer";
import { resolveTimeZone, TIME_ZONE_COOKIE } from "../../../../lib/greeting";
import { libraryMetadata } from "../../../../lib/library-page";
import { failureScreen } from "../../../../lib/page-result";
import { callApi } from "../../../../lib/server-api";

type ControlPageProps = { params: Promise<{ code: string }> };

/** One API call per request for the title and the page (React cache). */
const loadControl = cache((code: string) =>
  callApi(libraryRoutes.getControl, { params: { code } }, { returnTo: `/library/${code}` }),
);

export async function generateMetadata({ params }: ControlPageProps): Promise<Metadata> {
  const { code } = await params;
  if (!CONTROL_CODE_PATTERN.test(code)) return libraryMetadata();
  const result = await loadControl(code);
  return result.ok ? libraryMetadata(result.data) : libraryMetadata();
}

/** One control: its wording, guidance and every mapping with its review status. */
export default async function ControlPage({ params }: ControlPageProps) {
  const viewer = await requireViewer();
  if (!viewer.ok) return viewer.screen;
  if (!viewer.me.permissions.includes("library.read")) {
    return <StatusScreen kind="forbidden" retryHref="/" />;
  }
  const { code } = await params;
  if (!CONTROL_CODE_PATTERN.test(code)) notFound();
  const path = `/library/${code}`;
  const [result, operation] = await Promise.all([
    loadControl(code),
    callApi(controlOperationRoutes.operation, { params: { code } }, { returnTo: path }),
  ]);
  if (!result.ok) return failureScreen(result, path);
  // A sign-in problem is the same for both calls; any other failure of the panel leaves the control readable.
  if (!operation.ok && (operation.kind === "signed-out" || operation.kind === "reauth")) {
    return failureScreen(operation, path);
  }

  const timeZone = resolveTimeZone((await cookies()).get(TIME_ZONE_COOKIE)?.value);
  return (
    <ControlDetail
      control={result.data}
      canReview={viewer.me.permissions.includes("library.review")}
      timeZone={timeZone}
      operation={operation.ok ? operation.data : null}
    />
  );
}
