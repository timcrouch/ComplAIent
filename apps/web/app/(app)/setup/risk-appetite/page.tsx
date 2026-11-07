import { AppetiteForm } from "../../../../components/setup/appetite-form";
import { ReviewIntervalForm } from "../../../../components/setup/review-interval-form";
import { SetupFrame } from "../../../../components/setup/setup-frame";
import { stepMetadata } from "../../../../lib/setup-metadata";
import { loadSetupPage } from "../../../../lib/setup-page";

export const metadata = stepMetadata("riskAppetite");

export default async function RiskAppetiteStepPage() {
  const page = await loadSetupPage("/setup/risk-appetite");
  if (!page.ok) return page.screen;
  const { riskScale, defaultRiskScale, reviewIntervalMonths, setup } = page.organisation;
  return (
    <SetupFrame current="riskAppetite" missing={setup.missing}>
      <div className="flex flex-col gap-10">
        <AppetiteForm
          scale={riskScale ?? defaultRiskScale}
          saved={riskScale?.appetiteThreshold ?? null}
        />
        <ReviewIntervalForm months={reviewIntervalMonths} />
      </div>
    </SetupFrame>
  );
}
