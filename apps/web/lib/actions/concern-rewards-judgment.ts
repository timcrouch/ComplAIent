"use server";

import { JudgeConcernInput, concernRewardRoutes, type ConcernEvaluationDto } from "@isms/contracts";
import { z } from "zod";
import { invalid, revalidated } from "../action-results";
import { callApi, type CallResult } from "../server-api";

const PATH = "/concern-evaluations";

export async function judgeConcern(
  riskId: string,
  input: z.input<typeof JudgeConcernInput>,
): Promise<CallResult<ConcernEvaluationDto>> {
  const id = z.uuid().safeParse(riskId);
  const body = JudgeConcernInput.safeParse(input);
  if (!id.success) return invalid(id.error);
  if (!body.success) return invalid(body.error);
  return revalidated(
    await callApi(
      concernRewardRoutes.judge,
      { params: { id: id.data }, body: body.data },
      { returnTo: PATH },
    ),
    PATH,
  );
}
