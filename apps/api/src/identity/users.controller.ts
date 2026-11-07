import { Body, Controller, Param, Req } from "@nestjs/common";
import {
  type GrantRoleRequest,
  type ListUsersResponse,
  type RoleAssignmentDetailDto,
  peopleRoutes,
} from "@isms/contracts";
import type { Request } from "express";
import { auditContextFrom } from "../audit/index.js";
import { ContractRoute } from "../platform/index.js";
import { RoleAssignmentService } from "./role-assignment.service.js";

/** Users and their role assignments. Permissions and recent sign-in: see `peopleRoutes`. */
@Controller()
export class UsersController {
  constructor(private readonly assignments: RoleAssignmentService) {}

  @ContractRoute(peopleRoutes.listUsers)
  async listUsers(): Promise<ListUsersResponse> {
    return { users: await this.assignments.listUsers() };
  }

  @ContractRoute(peopleRoutes.grantRole)
  grantRole(
    @Param("userId") userId: string,
    @Body() body: GrantRoleRequest,
    @Req() req: Request,
  ): Promise<RoleAssignmentDetailDto> {
    return this.assignments.grant(userId, body, auditContextFrom(req));
  }

  @ContractRoute(peopleRoutes.revokeRole)
  revokeRole(
    @Param("assignmentId") assignmentId: string,
    @Req() req: Request,
  ): Promise<RoleAssignmentDetailDto> {
    return this.assignments.revoke(assignmentId, auditContextFrom(req));
  }
}
