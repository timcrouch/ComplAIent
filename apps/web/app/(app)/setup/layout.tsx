import { demoRoutes, type DemoStatusResponse } from "@isms/contracts";
import type { ReactNode } from "react";
import { DemoTools } from "../../../components/setup/demo-tools";
import { requestLog } from "../../../lib/log";
import { type CallFailureKind, callApi } from "../../../lib/server-api";

/** Expected answers, not failures: demo mode is off (404), or the viewer has no setup rights (403). */
const EXPECTED: readonly CallFailureKind[] = ["not-found", "forbidden"];

/**
 * The demo status, or null. A 404 means demo mode is off (the routes do not exist), a 403 that
 * the viewer may not use the demo tools, and any other failure must not break Setup: all show
 * nothing, and only an unexpected failure is logged.
 */
async function demoStatus(): Promise<DemoStatusResponse | null> {
  const result = await callApi(demoRoutes.status, {}, { returnTo: "/setup" });
  if (result.ok) return result.data;
  if (!EXPECTED.includes(result.kind)) {
    (await requestLog()).warn({ event: "web.demo_status_unavailable", kind: result.kind });
  }
  return null;
}

/** Setup's steps, with the demo and training tools below them when demo mode is on. */
export default async function SetupLayout({ children }: { children: ReactNode }) {
  const status = await demoStatus();
  return (
    <>
      {children}
      <DemoTools status={status} />
    </>
  );
}
