import { evidenceRoutes } from "@isms/contracts";
import type { NextRequest } from "next/server";
import { fieldValue, handleUpload } from "../../../../../lib/upload";

export const dynamic = "force-dynamic";

/**
 * POST /risks/{id}/evidence: a reviewer attaches a file to accepted controls of the risk.
 * `multipart/form-data`: `classification`, `collectedAt` (optional) and one or more
 * `controlIds`, then `file`. Answers with `UploadResult` JSON (lib/upload.ts).
 */
export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> },
): Promise<Response> {
  const { id } = await params;
  return handleUpload(request, {
    route: evidenceRoutes.upload,
    id,
    returnTo: `/risks/${id}`,
    query: ({ fields, fileName, mimeType }) => {
      const collectedAt = fieldValue(fields, "collectedAt");
      return {
        fileName,
        mimeType,
        classification: fieldValue(fields, "classification") ?? "internal",
        ...(collectedAt ? { collectedAt } : {}),
        controlIds: (fields.get("controlIds") ?? []).join(","),
      };
    },
  });
}
