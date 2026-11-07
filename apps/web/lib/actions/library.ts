"use server";

import {
  controlOperationRoutes,
  type ControlTestStepsResponse,
  RecordControlTestInput,
  type ControlTestDto,
  libraryRoutes,
  type MappingDto,
} from "@isms/contracts";
import { CONTROL_CODE_PATTERN } from "@isms/domain";
import { headers } from "next/headers";
import { z } from "zod";
import { invalid, revalidated } from "../action-results";
import { REQUEST_PATH_HEADER } from "../request-path";
import { safeReturnTo } from "../return-to";
import { callApi, type CallResult } from "../server-api";

const LIBRARY = "/library";

/**
 * The control page the action was posted from (server actions post to the page's own URL,
 * which the proxy passes on), so a new sign-in returns there. Anything outside the library
 * returns to the library.
 */
async function controlPath(): Promise<string> {
  const path = safeReturnTo((await headers()).get(REQUEST_PATH_HEADER));
  return path.startsWith(`${LIBRARY}/`) ? path : LIBRARY;
}

/** Marks one control-to-requirement mapping as reviewed; repeating it keeps the first review. */
export async function reviewMapping(mappingId: string): Promise<CallResult<MappingDto>> {
  const id = z.uuid().safeParse(mappingId);
  if (!id.success) return invalid(id.error);
  const result = await callApi(
    libraryRoutes.reviewMapping,
    { params: { mappingId: id.data } },
    { returnTo: await controlPath() },
  );
  return revalidated(result, LIBRARY);
}

/** Records a test of a control, with the evidence it used. 400 `details` name the field at fault. */
export async function recordControlTest(
  code: string,
  input: z.input<typeof RecordControlTestInput>,
): Promise<CallResult<ControlTestDto>> {
  const parsedCode = z.string().regex(CONTROL_CODE_PATTERN).safeParse(code);
  if (!parsedCode.success) return invalid(parsedCode.error);
  const body = RecordControlTestInput.safeParse(input);
  if (!body.success) return invalid(body.error);
  const result = await callApi(
    controlOperationRoutes.recordTest,
    { params: { code: parsedCode.data }, body: body.data },
    { returnTo: await controlPath() },
  );
  return revalidated(result, LIBRARY);
}

/** Asks the AI for steps to test a control; nothing is stored. 409 `aiUnavailable.<reason>` when it cannot. */
export async function suggestTestSteps(
  code: string,
): Promise<CallResult<ControlTestStepsResponse>> {
  const parsedCode = z.string().regex(CONTROL_CODE_PATTERN).safeParse(code);
  if (!parsedCode.success) return invalid(parsedCode.error);
  return callApi(
    controlOperationRoutes.suggestTestSteps,
    { params: { code: parsedCode.data } },
    { returnTo: await controlPath() },
  );
}
