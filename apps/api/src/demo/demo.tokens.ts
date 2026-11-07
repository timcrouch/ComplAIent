import type { StorageSettings } from "@isms/demo";

/** What reset and load do outside the database (`DemoPorts`); tests replace it with fakes. */
export const DEMO_PORTS = Symbol("DEMO_PORTS");
/** The owner-role Prisma client: created only when demo mode is on, for reset and load only. */
export const DEMO_OWNER_DB = Symbol("DEMO_OWNER_DB");
export const DEMO_OPTIONS = Symbol("DEMO_OPTIONS");

export type DemoModuleOptions = {
  /** `config.demo.ownerUrl`: the owner connection the reset needs (spec §5.4). */
  ownerUrl: string;
  /** Required when demo mode is on; given administrator by every load. */
  bootstrapAdminEmail: string;
  storage: StorageSettings;
  redisUrl: string;
};
