import { cookies } from "next/headers";
import type { ReactNode } from "react";
import { AppShell } from "../../components/shell/app-shell";
import { requireViewer } from "../../lib/current-viewer";
import { parseTheme, THEME_COOKIE } from "../../lib/theme";

export const dynamic = "force-dynamic";

/**
 * Server-side session check for the first load of any (app) URL (the proxy only sees that a
 * cookie exists, and skips dotted paths). Pages repeat the check (see requireViewer), because
 * this layout is not re-rendered on client-side navigation. Only display fields of /me reach
 * the client shell, never tokens.
 */
export default async function AppLayout({ children }: { children: ReactNode }) {
  const [viewer, cookieStore] = await Promise.all([requireViewer(), cookies()]);
  if (!viewer.ok) {
    return <main className="flex min-h-dvh items-center justify-center p-6">{viewer.screen}</main>;
  }

  const { displayName, email, viewMode, permissions, modules } = viewer.me;
  return (
    <AppShell
      user={{ displayName, email }}
      viewMode={viewMode}
      permissions={permissions}
      modules={modules}
      theme={parseTheme(cookieStore.get(THEME_COOKIE)?.value)}
    >
      {children}
    </AppShell>
  );
}
