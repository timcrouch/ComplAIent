import { z } from "zod";
import "./zod.js";

/**
 * The optional modules (#16 §1). Off means the module does not exist: every route of a module
 * answers 404 while it is off (`RouteDef.module`). A later module adds a value.
 */
export const ModuleKeySchema = z.enum(["eu_ai_act"]).openapi("ModuleKey");
export type ModuleKey = z.infer<typeof ModuleKeySchema>;
