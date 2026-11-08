import { Module } from "@nestjs/common";
import { AuditModule } from "../audit/index.js";
import { LibraryModule } from "../library/index.js";
import { OrganisationFrameworksService } from "./organisation-frameworks.service.js";
import { OrganisationModulesService } from "./organisation-modules.service.js";
import { OrganisationUnitsService } from "./organisation-units.service.js";
import { OrganisationController } from "./organisation.controller.js";
import { OrganisationService } from "./organisation.service.js";
import { RiskScaleService } from "./risk-scale.service.js";

/** Organisation setup API. Needs the global IdentityModule (CLOCK) and PRISMA. */
@Module({
  imports: [AuditModule, LibraryModule],
  controllers: [OrganisationController],
  providers: [
    OrganisationService,
    OrganisationUnitsService,
    OrganisationFrameworksService,
    OrganisationModulesService,
    RiskScaleService,
  ],
  exports: [RiskScaleService],
})
export class OrganisationModule {}
