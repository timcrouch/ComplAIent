import { Module } from "@nestjs/common";
import { AuditModule } from "../audit/index.js";
import { ControlQueryService } from "./control-query.service.js";
import { FrameworkCatalog } from "./framework-catalog.service.js";
import { LibraryController } from "./library.controller.js";
import { MappingReviewService } from "./mapping-review.service.js";

/** The control library API. Needs the global IdentityModule (CLOCK) and PRISMA. */
@Module({
  imports: [AuditModule],
  controllers: [LibraryController],
  providers: [FrameworkCatalog, ControlQueryService, MappingReviewService],
  exports: [FrameworkCatalog],
})
export class LibraryModule {}
