import { Controller, HttpCode, Param, Query, Req } from "@nestjs/common";
import {
  type ControlDetailDto,
  type ControlListQuery,
  type ControlListResponse,
  type ExportLibraryResponse,
  type ListFrameworksResponse,
  type MappingDto,
  libraryRoutes,
} from "@isms/contracts";
import type { Request } from "express";
import { auditContextFrom } from "../audit/index.js";
import { CurrentActor, type Actor } from "../identity/index.js";
import { ContractRoute } from "../platform/index.js";
import { ControlQueryService } from "./control-query.service.js";
import { FrameworkCatalog } from "./framework-catalog.service.js";
import { MappingReviewService } from "./mapping-review.service.js";

/** The control library: frameworks, controls, mapping review and export. */
@Controller()
export class LibraryController {
  constructor(
    private readonly catalog: FrameworkCatalog,
    private readonly controls: ControlQueryService,
    private readonly reviews: MappingReviewService,
  ) {}

  @ContractRoute(libraryRoutes.listFrameworks)
  async listFrameworks(): Promise<ListFrameworksResponse> {
    return { frameworks: await this.catalog.list() };
  }

  @ContractRoute(libraryRoutes.listControls)
  listControls(@Query() query: ControlListQuery): Promise<ControlListResponse> {
    return this.controls.list(query);
  }

  @ContractRoute(libraryRoutes.getControl)
  getControl(@Param("code") code: string): Promise<ControlDetailDto> {
    return this.controls.get(code);
  }

  @ContractRoute(libraryRoutes.reviewMapping)
  @HttpCode(200)
  reviewMapping(
    @Param("mappingId") mappingId: string,
    @CurrentActor() actor: Actor,
    @Req() req: Request,
  ): Promise<MappingDto> {
    return this.reviews.review(mappingId, actor.userId, auditContextFrom(req));
  }

  @ContractRoute(libraryRoutes.exportLibrary)
  exportLibrary(): Promise<ExportLibraryResponse> {
    return this.controls.export();
  }
}
