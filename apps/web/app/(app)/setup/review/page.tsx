import { cookies } from "next/headers";
import { ReviewSummary } from "../../../../components/setup/review-summary";
import { SetupFrame } from "../../../../components/setup/setup-frame";
import { countryOptions } from "../../../../lib/countries";
import { resolveTimeZone, TIME_ZONE_COOKIE } from "../../../../lib/greeting";
import { stepMetadata } from "../../../../lib/setup-metadata";
import { loadSetupPage } from "../../../../lib/setup-page";

export const metadata = stepMetadata("review");

export default async function ReviewStepPage() {
  const page = await loadSetupPage("/setup/review");
  if (!page.ok) return page.screen;
  const timeZone = resolveTimeZone((await cookies()).get(TIME_ZONE_COOKIE)?.value);
  return (
    <SetupFrame current="review" missing={page.organisation.setup.missing}>
      <ReviewSummary
        organisation={page.organisation}
        countries={countryOptions()}
        timeZone={timeZone}
      />
    </SetupFrame>
  );
}
