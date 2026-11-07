export type EvidenceMagic = "pdf" | "png" | "jpeg" | "webp" | "zip" | "text";

export const EVIDENCE_TYPES: Readonly<
  Record<string, { readonly extensions: readonly string[]; readonly magic: EvidenceMagic }>
> = {
  "application/pdf": { extensions: ["pdf"], magic: "pdf" },
  "image/png": { extensions: ["png"], magic: "png" },
  "image/jpeg": { extensions: ["jpg", "jpeg"], magic: "jpeg" },
  "image/webp": { extensions: ["webp"], magic: "webp" },
  "text/plain": { extensions: ["txt"], magic: "text" },
  "text/csv": { extensions: ["csv"], magic: "text" },
  "application/vnd.openxmlformats-officedocument.wordprocessingml.document": {
    extensions: ["docx"],
    magic: "zip",
  },
  "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet": {
    extensions: ["xlsx"],
    magic: "zip",
  },
  "application/vnd.openxmlformats-officedocument.presentationml.presentation": {
    extensions: ["pptx"],
    magic: "zip",
  },
};

export type EvidenceCheck =
  { ok: true; mime: string } | { ok: false; reason: "evidenceTypeNotAllowed" };

const startsWith = (head: Uint8Array, sig: readonly number[], at = 0): boolean =>
  head.length >= at + sig.length && sig.every((b, i) => head[at + i] === b);

function magicMatches(head: Uint8Array, magic: EvidenceMagic): boolean {
  switch (magic) {
    case "pdf":
      return startsWith(head, [0x25, 0x50, 0x44, 0x46, 0x2d]);
    case "png":
      return startsWith(head, [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
    case "jpeg":
      return startsWith(head, [0xff, 0xd8, 0xff]);
    case "webp":
      return (
        startsWith(head, [0x52, 0x49, 0x46, 0x46]) && startsWith(head, [0x57, 0x45, 0x42, 0x50], 8)
      );
    case "zip":
      return startsWith(head, [0x50, 0x4b, 0x03, 0x04]);
    case "text": {
      if (head.includes(0)) return false;
      try {
        // stream: true tolerates a multi-byte character cut at the end of the head.
        new TextDecoder("utf-8", { fatal: true }).decode(head, {
          stream: true,
        });
        return true;
      } catch {
        return false;
      }
    }
  }
}

const REFUSED: EvidenceCheck = { ok: false, reason: "evidenceTypeNotAllowed" };

/** Checks the declared MIME, the file extension and the leading bytes agree on an allowed type. */
export function detectEvidenceType(
  head: Uint8Array,
  declaredMime: string,
  fileName: string,
): EvidenceCheck {
  const type = Object.hasOwn(EVIDENCE_TYPES, declaredMime)
    ? EVIDENCE_TYPES[declaredMime]
    : undefined;
  if (!type) return REFUSED;
  const dot = fileName.lastIndexOf(".");
  const ext = dot >= 0 ? fileName.slice(dot + 1).toLowerCase() : "";
  if (!type.extensions.includes(ext)) return REFUSED;
  return magicMatches(head, type.magic) ? { ok: true, mime: declaredMime } : REFUSED;
}
