import { Body, Controller, HttpCode, Param, Req } from "@nestjs/common";
import {
  type CompleteSetupResponse,
  type ConcernRewardsSettingsDto,
  type ConcernRewardsSettingsInput,
  type FrameworksInput,
  type FrameworksResponse,
  type ModuleKey,
  type ModulesResponse,
  type OrganisationResponse,
  type ProfileInput,
  type ReviewIntervalInput,
  type RiskScaleDto,
  type RiskScaleInput,
  type ResumeConcernRewardsResponse,
  type SetModuleInput,
  type UnitsInput,
  type UnitsResponse,
  organisationRoutes,
} from "@isms/contracts";
import type { Request } from "express";
import { auditContextFrom } from "../audit/index.js";
import { ContractRoute } from "../platform/index.js";
import { OrganisationFrameworksService } from "./organisation-frameworks.service.js";
import { OrganisationModulesService } from "./organisation-modules.service.js";
import { OrganisationUnitsService } from "./organisation-units.service.js";
import { OrganisationService } from "./organisation.service.js";
import { RiskScaleService } from "./risk-scale.service.js";

/** Organisation setup. Everyone signed in reads it; administrators change it. */
@Controller()
export class OrganisationController {
  constructor(
    private readonly organisation: OrganisationService,
    private readonly units: OrganisationUnitsService,
    private readonly frameworks: OrganisationFrameworksService,
    private readonly riskScale: RiskScaleService,
    private readonly modules: OrganisationModulesService,
  ) {}

  @ContractRoute(organisationRoutes.get)
  get(): Promise<OrganisationResponse> {
    return this.organisation.get();
  }

  @ContractRoute(organisationRoutes.updateProfile)
  updateProfile(@Body() body: ProfileInput, @Req() req: Request): Promise<OrganisationResponse> {
    return this.organisation.updateProfile(body, auditContextFrom(req));
  }

  @ContractRoute(organisationRoutes.replaceUnits)
  replaceUnits(@Body() body: UnitsInput, @Req() req: Request): Promise<UnitsResponse> {
    return this.units.replace(body, auditContextFrom(req));
  }

  @ContractRoute(organisationRoutes.setFrameworks)
  async setFrameworks(
    @Body() body: FrameworksInput,
    @Req() req: Request,
  ): Promise<FrameworksResponse> {
    return {
      frameworks: await this.frameworks.set(body, auditContextFrom(req)),
    };
  }

  @ContractRoute(organisationRoutes.suggestFrameworks)
  @HttpCode(200)
  async suggestFrameworks(@Req() req: Request): Promise<FrameworksResponse> {
    return { frameworks: await this.frameworks.suggest(auditContextFrom(req)) };
  }

  @ContractRoute(organisationRoutes.setRiskScale)
  setRiskScale(@Body() body: RiskScaleInput, @Req() req: Request): Promise<RiskScaleDto> {
    return this.riskScale.set(body, auditContextFrom(req));
  }

  @ContractRoute(organisationRoutes.setReviewInterval)
  setReviewInterval(
    @Body() body: ReviewIntervalInput,
    @Req() req: Request,
  ): Promise<OrganisationResponse> {
    return this.organisation.setReviewInterval(body, auditContextFrom(req));
  }

  @ContractRoute(organisationRoutes.setConcernRewards)
  setConcernRewards(
    @Body() body: ConcernRewardsSettingsInput,
    @Req() req: Request,
  ): Promise<ConcernRewardsSettingsDto> {
    return this.organisation.setConcernRewards(body, auditContextFrom(req));
  }

  @ContractRoute(organisationRoutes.resumeConcernRewards)
  @HttpCode(200)
  resumeConcernRewards(@Req() req: Request): Promise<ResumeConcernRewardsResponse> {
    return this.organisation.resumeConcernRewards(auditContextFrom(req));
  }

  @ContractRoute(organisationRoutes.setModule)
  setModule(
    @Param("key") key: ModuleKey,
    @Body() body: SetModuleInput,
    @Req() req: Request,
  ): Promise<ModulesResponse> {
    return this.modules.set(key, body.enabled, auditContextFrom(req));
  }

  @ContractRoute(organisationRoutes.completeSetup)
  @HttpCode(200)
  completeSetup(@Req() req: Request): Promise<CompleteSetupResponse> {
    return this.organisation.complete(auditContextFrom(req));
  }
}
