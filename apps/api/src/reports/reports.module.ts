import { Module } from "@nestjs/common";
import { AuditModule } from "../audit/index.js";
import { OrganisationModule } from "../organisation/index.js";
import { RisksModule } from "../risks/index.js";
import { BoardService } from "./board.service.js";
import { NarrativeService } from "./narrative.service.js";
import { ReportFilesController } from "./report-files.controller.js";
import { ReportsController } from "./reports.controller.js";
import { ReportsService } from "./reports.service.js";
import { SoaService } from "./soa.service.js";

/**
 * The reports (§5): a leaf module over the risks, organisation and audit modules. Needs the
 * global AuthorizationModule (PolicyService), IdentityModule (CLOCK), AiModule and PRISMA.
 */
@Module({
  imports: [AuditModule, OrganisationModule, RisksModule],
  controllers: [ReportsController, ReportFilesController],
  providers: [ReportsService, SoaService, BoardService, NarrativeService],
  exports: [ReportsService, SoaService, BoardService],
})
export class ReportsModule {}
