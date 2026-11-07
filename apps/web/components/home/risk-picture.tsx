import type { RiskPictureDto, RiskScaleDto } from "@isms/contracts";
import { useTranslations } from "next-intl";
import { RiskMap } from "../risks/risk-map";
import { glass } from "./styles";
import { HomeSection } from "./home-section";
import { RiskMovement } from "./risk-movement";

const MAP_HREF = "/risks?view=map";

/** Home: where the risks sit on the map, and how many were reported and approved lately. */
export function RiskPicture({ picture, scale }: { picture: RiskPictureDto; scale: RiskScaleDto }) {
  const t = useTranslations("insights.picture");
  return (
    <HomeSection
      id="home-risk-picture"
      title={t("title")}
      more={{ href: MAP_HREF, label: t("more") }}
    >
      <div className={`${glass} flex flex-col gap-6 p-4 sm:p-5`}>
        <RiskMap map={picture.map} scale={scale} compact cellHref={() => MAP_HREF} />
        <RiskMovement movement={picture.movement} />
      </div>
    </HomeSection>
  );
}
