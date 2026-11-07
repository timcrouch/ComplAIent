import { notFound } from "next/navigation";
import { requireViewer } from "../../../lib/current-viewer";

/**
 * Unknown paths render inside (app), so the session check runs for them too, including
 * dotted paths the proxy skips (e.g. /x/v1.2): signed-out users are sent to sign-in, signed-in
 * users get the not-found page. Static-asset-like paths (/missing.png, /favicon.ico) never get
 * here: next.config.ts rewrites them to a plain 404 without a session lookup.
 */
export default async function UnknownPage() {
  const viewer = await requireViewer();
  if (!viewer.ok) return viewer.screen;
  notFound();
}
