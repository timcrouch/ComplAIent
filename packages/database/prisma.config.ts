import { defineConfig } from "prisma/config";

export default defineConfig({
  schema: "prisma/schema",
  migrations: { path: "prisma/migrations" },
  // `prisma generate` needs no connection, so do not fail when this is unset.
  datasource: { url: process.env["DATABASE_OWNER_URL"] ?? "" },
});
