import { getTranslations } from "next-intl/server";
import Link from "next/link";
import { requireViewer } from "../../lib/current-viewer";

export default async function NotFound() {
  const viewer = await requireViewer();
  if (!viewer.ok) return viewer.screen;
  const t = await getTranslations("notFound");
  return (
    <div className="mx-auto flex max-w-[560px] flex-col items-start gap-4 pt-10">
      <h1 className="text-[32px] leading-tight font-bold tracking-[-0.025em]">{t("title")}</h1>
      <p className="text-[15px] leading-relaxed text-fg-muted">{t("body")}</p>
      <Link
        href="/"
        className="inline-flex h-10 items-center rounded-sm bg-accent px-4 text-sm font-semibold text-on-accent outline-none focus-visible:ring-2 focus-visible:ring-focus-ring focus-visible:ring-offset-2 focus-visible:ring-offset-bg"
      >
        {t("home")}
      </Link>
    </div>
  );
}
