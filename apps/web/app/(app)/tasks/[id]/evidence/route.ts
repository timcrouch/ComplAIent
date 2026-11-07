import { evidenceRoutes } from "@isms/contracts";
import type { NextRequest } from "next/server";
import { fieldValue, handleUpload } from "../../../../../lib/upload";

export const dynamic = "force-dynamic";

/**
 * POST /tasks/{id}/evidence: the assignee uploads the requested file, which completes the
 * task. `multipart/form-data`: `classification` (optional), then `file`.
 */
export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> },
): Promise<Response> {
  const { id } = await params;
  return handleUpload(request, {
    route: evidenceRoutes.uploadForTask,
    id,
    returnTo: "/tasks",
    query: ({ fields, fileName, mimeType }) => ({
      fileName,
      mimeType,
      classification: fieldValue(fields, "classification") ?? "internal",
    }),
  });
}
