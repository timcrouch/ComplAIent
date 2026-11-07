import { CONTROL_CATEGORIES, CONTROL_CODE_PATTERN } from "@isms/domain";
import { z } from "zod";

const text = z.string().min(1);

/** Lists the content files. Frameworks and controls are named relative to the content directory. */
export const ManifestSchema = z
  .object({
    libraryVersion: z.string().regex(/^\d{4}\.\d{2}\.\d+$/),
    frameworks: z.array(text),
    controls: z.array(text),
    /** Mapping files that add mappings to the controls (P12-R3). */
    mappings: z.array(text).optional(),
  })
  .strict();

/**
 * A heading the requirements sit under, for example a NIST CSF Function (`GV`) or Category
 * (`GV.OC`), or an ISO Annex A theme (`A.5`). At most two levels: `parent` names a top-level group.
 */
export const RequirementGroupSchema = z
  .object({ key: text, title: text, parent: text.optional() })
  .strict();

/**
 * No `fullText` here: licensed standard text is never shipped (ADR-0008). `groups` is optional:
 * flat frameworks omit it, and then no requirement names a `group` (checked by validateLibrary).
 */
export const FrameworkFileSchema = z
  .object({
    framework: z.object({ key: text, name: text, publisher: text, summary: text }).strict(),
    version: z.object({ key: text, label: text }).strict(),
    groups: z.array(RequirementGroupSchema).min(1).optional(),
    requirements: z
      .array(z.object({ ref: text, title: text, group: text.optional() }).strict())
      .min(1),
  })
  .strict();

/** Mappings kept outside the control files, all to one framework version (P12-R3). */
export const MappingFileSchema = z
  .object({
    framework: text,
    mappings: z
      .array(z.object({ control: z.string().regex(CONTROL_CODE_PATTERN), ref: text }).strict())
      .min(1),
  })
  .strict();

export const ControlEntrySchema = z
  .object({
    code: z.string().regex(CONTROL_CODE_PATTERN),
    title: text,
    description: text,
    guidance: z.array(text),
    category: z.enum(CONTROL_CATEGORIES),
    mappings: z
      .array(
        z
          .object({
            /** Framework version key. */
            framework: text,
            ref: text,
          })
          .strict(),
      )
      .min(1),
  })
  .strict();

export const ControlFileSchema = z.object({ controls: z.array(ControlEntrySchema) }).strict();

export type Manifest = z.infer<typeof ManifestSchema>;
export type FrameworkFile = z.infer<typeof FrameworkFileSchema>;
export type RequirementGroup = z.infer<typeof RequirementGroupSchema>;
export type ControlEntry = z.infer<typeof ControlEntrySchema>;

export type LibraryContent = {
  libraryVersion: string;
  frameworks: FrameworkFile[];
  controls: ControlEntry[];
};
