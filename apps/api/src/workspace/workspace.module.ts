import { Module } from "@nestjs/common";
import { OrganisationModule } from "../organisation/index.js";
import { RisksModule } from "../risks/index.js";
import { WorkspaceController } from "./workspace.controller.js";
import { WorkspaceService } from "./workspace.service.js";

/** The home workspace. Needs the global AuthorizationModule (PolicyService) and PRISMA. */
@Module({
  imports: [OrganisationModule, RisksModule],
  controllers: [WorkspaceController],
  providers: [WorkspaceService],
})
export class WorkspaceModule {}
