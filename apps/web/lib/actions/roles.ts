"use server";

import { GrantRoleRequest, peopleRoutes, type RoleAssignmentDetailDto } from "@isms/contracts";
import { z } from "zod";
import { invalid, revalidated } from "../action-results";
import { callApi, type CallResult } from "../server-api";

// Role changes are recentAuth routes (P2-R5): a stale sign-in comes back as `reauth` with a
// step-up sign-in URL that returns to the people step.
const RETURN_TO = { returnTo: "/setup/people" };

/** Grants a role to a user at organisation, site or department scope. */
export async function grantRole(
  userId: string,
  input: z.input<typeof GrantRoleRequest>,
): Promise<CallResult<RoleAssignmentDetailDto>> {
  const id = z.uuid().safeParse(userId);
  if (!id.success) return invalid(id.error);
  const body = GrantRoleRequest.safeParse(input);
  if (!body.success) return invalid(body.error);
  return revalidated(
    await callApi(
      peopleRoutes.grantRole,
      { params: { userId: id.data }, body: body.data },
      RETURN_TO,
    ),
  );
}

/** Removes one role assignment; the API refuses to remove the last organisation administrator. */
export async function revokeRole(
  assignmentId: string,
): Promise<CallResult<RoleAssignmentDetailDto>> {
  const id = z.uuid().safeParse(assignmentId);
  if (!id.success) return invalid(id.error);
  return revalidated(
    await callApi(peopleRoutes.revokeRole, { params: { assignmentId: id.data } }, RETURN_TO),
  );
}
