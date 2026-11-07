import type { UploadResult } from "../../lib/upload";

type UploadFailure = Exclude<UploadResult, { ok: true }>;

const unavailable: UploadFailure = { ok: false, kind: "unavailable", details: [] };

/**
 * Sends the form to a BFF upload route (same origin, so the browser adds the Origin header
 * the route checks). The route answers with `UploadResult` JSON; anything else is "unavailable".
 */
export async function sendUpload(url: string, form: FormData): Promise<UploadResult> {
  let res: Response;
  try {
    res = await fetch(url, {
      method: "POST",
      body: form,
      credentials: "same-origin",
      headers: { accept: "application/json" },
    });
  } catch {
    return unavailable;
  }
  try {
    const json = (await res.json()) as unknown;
    if (json && typeof json === "object" && "ok" in json) return json as UploadResult;
  } catch {
    // Not our JSON: fall through to the status.
  }
  return res.status === 413 ? { ok: false, kind: "too-large", details: [] } : unavailable;
}
