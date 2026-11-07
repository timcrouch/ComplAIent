import type { Permission } from "@isms/contracts";
import type { Actor } from "./actor.js";

/** Resolves an actor's effective permissions; implemented by authorization's PolicyService. */
export interface PermissionsProvider {
  permissionsFor(actor: Actor): Permission[];
}

export const PERMISSIONS_PROVIDER = Symbol("PERMISSIONS_PROVIDER");
