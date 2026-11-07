import { Controller } from "@nestjs/common";
import { type WorkspaceResponse, workspaceRoutes } from "@isms/contracts";
import { type Actor, CurrentActor } from "../identity/index.js";
import { ContractRoute } from "../platform/index.js";
import { WorkspaceService } from "./workspace.service.js";

/** The home workspace, for everyone signed in. */
@Controller()
export class WorkspaceController {
  constructor(private readonly workspace: WorkspaceService) {}

  @ContractRoute(workspaceRoutes.get)
  get(@CurrentActor() actor: Actor): Promise<WorkspaceResponse> {
    return this.workspace.get(actor);
  }
}
