import { CloudOffIcon, KeyRoundIcon, LockIcon } from "lucide-react";
import { getTranslations } from "next-intl/server";

type StatusKind = "sign-in-unavailable" | "sign-in-rejected" | "unavailable" | "forbidden";

const KEYS = {
  "sign-in-unavailable": "signInUnavailable",
  "sign-in-rejected": "signInRejected",
  unavailable: "unavailable",
  forbidden: "forbidden",
} as const;

const ICONS = {
  "sign-in-unavailable": KeyRoundIcon,
  "sign-in-rejected": KeyRoundIcon,
  unavailable: CloudOffIcon,
  forbidden: LockIcon,
} as const;

/**
 * Error card for when the workspace cannot be shown. The (app) layout places it in a bare
 * <main>; a page renders it inside the shell's <main> (requireViewer). It never redirects by itself, so a
 * failing IdP or API cannot cause a redirect loop; the user retries with the link.
 */
export async function StatusScreen({ kind, retryHref }: { kind: StatusKind; retryHref: string }) {
  const t = await getTranslations("status");
  const key = KEYS[kind];
  const Icon = ICONS[kind];
  return (
    <div className="flex justify-center py-6">
      <div className="flex w-full max-w-[460px] flex-col items-start gap-4 rounded-lg border border-surface-border bg-surface p-8 shadow-glass">
        <span className="inline-flex size-11 items-center justify-center rounded-full bg-attention-soft text-attention">
          <Icon aria-hidden className="size-5" />
        </span>
        <h1 className="text-2xl leading-tight font-bold tracking-[-0.02em]">{t(`${key}.title`)}</h1>
        <p className="text-[15px] leading-relaxed text-fg-muted">{t(`${key}.body`)}</p>
        <a
          href={retryHref}
          className="inline-flex h-10 items-center rounded-sm bg-accent px-4 text-sm font-semibold text-on-accent outline-none focus-visible:ring-2 focus-visible:ring-focus-ring focus-visible:ring-offset-2 focus-visible:ring-offset-bg"
        >
          {t(`${key}.retry`)}
        </a>
      </div>
    </div>
  );
}
