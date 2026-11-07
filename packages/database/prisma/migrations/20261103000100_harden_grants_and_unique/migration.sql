-- Organisation-scoped assignments have scopeId NULL, and plain unique indexes treat NULLs as
-- distinct, so duplicates slipped through. Recreate the index Prisma generates for
-- @@unique([userId, role, scopeType, scopeId]) under the same name with NULLS NOT DISTINCT
-- (PostgreSQL 15+). Prisma does not model NULLS NOT DISTINCT, so schema.prisma keeps the plain
-- @@unique, the index name stays identical, and `prisma migrate diff` reports no difference.
DROP INDEX "RoleAssignment_userId_role_scopeType_scopeId_key";
CREATE UNIQUE INDEX "RoleAssignment_userId_role_scopeType_scopeId_key"
  ON "RoleAssignment" ("userId", "role", "scopeType", "scopeId") NULLS NOT DISTINCT;

-- The runtime role must not touch Prisma's migration history. Prisma creates this table before
-- applying any migration, so it exists here (init's GRANT ON ALL TABLES covered it); the
-- to_regclass guard keeps this safe regardless. Tables created by later migrations are never
-- _prisma_migrations, so no further handling is needed.
DO $$
BEGIN
  IF to_regclass('public."_prisma_migrations"') IS NOT NULL THEN
    REVOKE ALL ON "_prisma_migrations" FROM isms_app;
  END IF;
END
$$;
