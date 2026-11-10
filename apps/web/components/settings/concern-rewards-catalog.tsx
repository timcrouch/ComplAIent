import { CONCERN_BADGES, CONCERN_RANKS } from "@isms/domain";
import Image from "next/image";
import { getTranslations } from "next-intl/server";

const imageKey = (key: string) => key.replaceAll("_", "-");
const BADGE_KEYS = Object.keys(CONCERN_BADGES) as (keyof typeof CONCERN_BADGES)[];

/** Administrator-facing explanation of the recognition people can earn. */
export async function ConcernRewardsCatalog() {
  const t = await getTranslations("settings.concernReporting.catalog");

  return (
    <section className="flex flex-col gap-7" aria-labelledby="concern-rewards-catalog-title">
      <div className="flex flex-col gap-1">
        <h2
          id="concern-rewards-catalog-title"
          className="text-[20px] font-semibold tracking-[-0.02em] text-fg"
        >
          {t("title")}
        </h2>
        <p className="max-w-[72ch] text-[14px] leading-relaxed text-fg-muted">{t("description")}</p>
      </div>

      <div className="flex flex-col gap-3">
        <h3 className="text-[15px] font-semibold text-fg">{t("ranksTitle")}</h3>
        <ol className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-5">
          {CONCERN_RANKS.map((rank) => (
            <li
              key={rank.key}
              className="flex min-w-0 flex-col items-center rounded-xl border border-surface-border bg-surface/70 p-3 text-center"
            >
              <Image
                src={`/images/concern-rewards/ranks/${imageKey(rank.key)}.png`}
                alt=""
                width={112}
                height={112}
                className="size-24 object-contain drop-shadow-sm sm:size-28"
              />
              <p className="mt-1 font-semibold text-fg">{rank.label}</p>
              <p className="text-xs text-fg-muted">
                {t("pointsRequired", { points: rank.minimumPoints })}
              </p>
            </li>
          ))}
        </ol>
      </div>

      <div className="flex flex-col gap-3">
        <h3 className="text-[15px] font-semibold text-fg">{t("badgesTitle")}</h3>
        <ul className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
          {BADGE_KEYS.map((key) => (
            <li
              key={key}
              className="flex items-center gap-3 rounded-xl border border-surface-border bg-surface/70 p-3"
            >
              <Image
                src={`/images/concern-rewards/badges/${imageKey(key)}.png`}
                alt=""
                width={72}
                height={72}
                className="size-[72px] shrink-0 object-contain"
              />
              <div className="min-w-0">
                <p className="font-semibold text-fg">{t(`badges.${key}.title`)}</p>
                {CONCERN_BADGES[key].repeatable ? (
                  <p className="text-[11px] font-semibold tracking-wide text-accent uppercase">
                    {t("repeatable")}
                  </p>
                ) : null}
                <p className="mt-0.5 text-xs leading-relaxed text-fg-muted">
                  {t(`badges.${key}.description`)}
                </p>
              </div>
            </li>
          ))}
        </ul>
      </div>
    </section>
  );
}
