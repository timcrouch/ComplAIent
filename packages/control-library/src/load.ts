import { readFileSync } from "node:fs";
import type { z } from "zod";
import {
  ControlFileSchema,
  FrameworkFileSchema,
  ManifestSchema,
  MappingFileSchema,
  type ControlEntry,
  type LibraryContent,
} from "./schema.js";

export class LibraryError extends Error {
  override readonly name = "LibraryError";
}

function readJson<T extends z.ZodType>(dir: URL, file: string, schema: T): z.infer<T> {
  let raw: unknown;
  try {
    raw = JSON.parse(readFileSync(new URL(file, dir), "utf8"));
  } catch (error) {
    const reason = error instanceof Error ? error.message : String(error);
    throw new LibraryError(`${file}: (file): ${reason}`);
  }
  const parsed = schema.safeParse(raw);
  if (!parsed.success) {
    const issue = parsed.error.issues[0];
    const path = issue?.path.join(".") || "(root)";
    throw new LibraryError(`${file}: ${path}: ${issue?.message ?? "invalid"}`);
  }
  return parsed.data;
}

function addMappings(dir: URL, file: string, controls: ControlEntry[]): void {
  const byCode = new Map(controls.map((c) => [c.code, c]));
  const { framework, mappings } = readJson(dir, file, MappingFileSchema);
  for (const [i, { control, ref }] of mappings.entries()) {
    const target = byCode.get(control);
    if (!target)
      throw new LibraryError(`${file}: mappings.${String(i)}.control: unknown control ${control}`);
    target.mappings.push({ framework, ref });
  }
}

export function loadLibrary(
  contentDir: URL = new URL("../content/", import.meta.url),
): LibraryContent {
  const dir = contentDir.href.endsWith("/") ? contentDir : new URL(`${contentDir.href}/`);
  const manifest = readJson(dir, "manifest.json", ManifestSchema);
  const controls = manifest.controls.flatMap((f) => readJson(dir, f, ControlFileSchema).controls);
  for (const file of manifest.mappings ?? []) addMappings(dir, file, controls);
  return {
    libraryVersion: manifest.libraryVersion,
    frameworks: manifest.frameworks.map((f) => readJson(dir, f, FrameworkFileSchema)),
    controls,
  };
}
