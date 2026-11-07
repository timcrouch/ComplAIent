import { ERROR_CODES } from "@isms/domain";
import { z } from "zod";
import "./zod.js";

export const ErrorCodeSchema = z.enum(ERROR_CODES);

export const ErrorResponse = z
  .object({
    error: z.object({
      code: ErrorCodeSchema,
      message: z.string(),
      requestId: z.string(),
      details: z.array(z.object({ path: z.string(), message: z.string() })).optional(),
    }),
  })
  .openapi("ErrorResponse");
export type ErrorResponse = z.infer<typeof ErrorResponse>;
