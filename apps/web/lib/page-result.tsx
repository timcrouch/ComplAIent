import "server-only";
import { notFound, redirect } from "next/navigation";
import type { ReactElement } from "react";
import { StatusScreen } from "../components/status/status-screen";
import type { CallResult } from "./server-api";

type Failure = Exclude<CallResult<unknown>, { ok: true }>;

/**
 * What a page shows when its API call fails. Sign-in problems redirect (to sign in again, or
 * to a fresh sign-in for step-up); everything else is a screen, never a redirect loop.
 */
export function failureScreen(result: Failure, path: string): ReactElement {
  switch (result.kind) {
    case "signed-out":
    case "reauth":
      redirect(result.href ?? "/");
    // eslint-disable-next-line no-fallthrough -- redirect() never returns
    case "not-found":
      notFound();
    // eslint-disable-next-line no-fallthrough -- notFound() never returns
    case "forbidden":
      return <StatusScreen kind="forbidden" retryHref="/" />;
    default:
      return <StatusScreen kind="unavailable" retryHref={path} />;
  }
}
