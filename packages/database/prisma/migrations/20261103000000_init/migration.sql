CREATE EXTENSION IF NOT EXISTS vector;

-- CreateSchema
CREATE SCHEMA IF NOT EXISTS "public";

-- CreateEnum
CREATE TYPE "ViewMode" AS ENUM ('guided', 'professional', 'executive');

-- CreateEnum
CREATE TYPE "Role" AS ENUM ('administrator', 'ciso', 'risk_owner', 'risk_approver', 'contributor', 'viewer', 'auditor');

-- CreateEnum
CREATE TYPE "ScopeType" AS ENUM ('ORGANISATION', 'SITE', 'DEPARTMENT');

-- CreateTable
CREATE TABLE "Organisation" (
    "id" UUID NOT NULL,
    "name" TEXT NOT NULL,
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Organisation_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Site" (
    "id" UUID NOT NULL,
    "name" TEXT NOT NULL,
    "countryCode" CHAR(2) NOT NULL,

    CONSTRAINT "Site_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Department" (
    "id" UUID NOT NULL,
    "name" TEXT NOT NULL,

    CONSTRAINT "Department_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "User" (
    "id" UUID NOT NULL,
    "idpIssuer" TEXT NOT NULL,
    "idpSubject" TEXT NOT NULL,
    "email" TEXT NOT NULL,
    "displayName" TEXT NOT NULL,
    "viewMode" "ViewMode" NOT NULL DEFAULT 'guided',
    "lastSeenAt" TIMESTAMPTZ(3),

    CONSTRAINT "User_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "RoleAssignment" (
    "id" UUID NOT NULL,
    "userId" UUID NOT NULL,
    "role" "Role" NOT NULL,
    "scopeType" "ScopeType" NOT NULL,
    "scopeId" UUID,
    "grantedById" UUID NOT NULL,
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "RoleAssignment_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "AuditEvent" (
    "id" UUID NOT NULL,
    "occurredAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "actorUserId" UUID,
    "action" TEXT NOT NULL,
    "objectType" TEXT NOT NULL,
    "objectId" TEXT NOT NULL,
    "beforeRef" JSONB,
    "afterRef" JSONB,
    "requestId" TEXT NOT NULL,
    "traceId" TEXT,

    CONSTRAINT "AuditEvent_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "User_idpIssuer_idpSubject_key" ON "User"("idpIssuer", "idpSubject");

-- CreateIndex
CREATE UNIQUE INDEX "RoleAssignment_userId_role_scopeType_scopeId_key" ON "RoleAssignment"("userId", "role", "scopeType", "scopeId");

-- CreateIndex
CREATE INDEX "AuditEvent_objectType_objectId_occurredAt_idx" ON "AuditEvent"("objectType", "objectId", "occurredAt");

-- AddForeignKey
ALTER TABLE "RoleAssignment" ADD CONSTRAINT "RoleAssignment_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "RoleAssignment" ADD CONSTRAINT "RoleAssignment_grantedById_fkey" FOREIGN KEY ("grantedById") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;


-- RoleAssignment.scopeId is NULL exactly when the scope is the organisation.
ALTER TABLE "RoleAssignment" ADD CONSTRAINT "RoleAssignment_scope_check"
  CHECK (("scopeType" = 'ORGANISATION') = ("scopeId" IS NULL));

-- AuditEvent is append-only. Row triggers also bind the owner role.
CREATE FUNCTION audit_event_append_only() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  RAISE EXCEPTION 'audit_event is append-only';
END;
$$;

CREATE TRIGGER "AuditEvent_append_only"
  BEFORE UPDATE OR DELETE ON "AuditEvent"
  FOR EACH ROW EXECUTE FUNCTION audit_event_append_only();

-- Runtime role privileges. The migration runs as isms_owner.
GRANT USAGE ON SCHEMA public TO isms_app;
GRANT SELECT, INSERT, UPDATE, DELETE ON ALL TABLES IN SCHEMA public TO isms_app;
GRANT USAGE, SELECT ON ALL SEQUENCES IN SCHEMA public TO isms_app;
ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT SELECT, INSERT, UPDATE, DELETE ON TABLES TO isms_app;
ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT USAGE, SELECT ON SEQUENCES TO isms_app;

REVOKE UPDATE, DELETE, TRUNCATE ON "AuditEvent" FROM isms_app;
