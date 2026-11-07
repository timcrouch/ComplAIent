-- CreateEnum
CREATE TYPE "AiPurpose" AS ENUM ('concern_turn', 'control_suggestion', 'framework_suggestion', 'connection_test');

-- CreateEnum
CREATE TYPE "AiCallStatus" AS ENUM ('ok', 'invalid_output', 'provider_error', 'refused');

-- CreateEnum
CREATE TYPE "AiOutcome" AS ENUM ('none', 'pending', 'accepted', 'rejected', 'partial');

-- CreateTable
CREATE TABLE "AiSettings" (
    "id" UUID NOT NULL,
    "singleton" BOOLEAN NOT NULL DEFAULT true,
    "enabled" BOOLEAN NOT NULL DEFAULT false,
    "euOnly" BOOLEAN NOT NULL DEFAULT true,
    "zeroRetention" BOOLEAN NOT NULL DEFAULT true,
    "sealedKey" BYTEA,
    "keyLast4" TEXT,
    "keySetById" UUID,
    "keySetAt" TIMESTAMPTZ(3),
    "models" JSONB NOT NULL DEFAULT '{}',
    "updatedById" UUID,
    "updatedAt" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "AiSettings_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "AiInteraction" (
    "id" UUID NOT NULL,
    "purpose" "AiPurpose" NOT NULL,
    "provider" TEXT NOT NULL,
    "model" TEXT NOT NULL,
    "routing" JSONB NOT NULL,
    "request" JSONB NOT NULL,
    "response" TEXT,
    "status" "AiCallStatus" NOT NULL,
    "attempts" INTEGER NOT NULL,
    "durationMs" INTEGER NOT NULL,
    "actorUserId" UUID,
    "objectType" TEXT,
    "objectId" TEXT,
    "outcome" "AiOutcome" NOT NULL DEFAULT 'none',
    "discardedCount" INTEGER NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "AiInteraction_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ControlEmbedding" (
    "controlId" UUID NOT NULL,
    "model" TEXT NOT NULL,
    "contentHash" TEXT NOT NULL,
    "embedding" vector(384) NOT NULL,
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ControlEmbedding_pkey" PRIMARY KEY ("controlId")
);

-- CreateIndex
CREATE UNIQUE INDEX "AiSettings_singleton_key" ON "AiSettings"("singleton");

-- CreateIndex
CREATE INDEX "AiInteraction_objectType_objectId_createdAt_idx" ON "AiInteraction"("objectType", "objectId", "createdAt");

-- AddForeignKey
ALTER TABLE "RiskControl" ADD CONSTRAINT "RiskControl_aiInteractionId_fkey" FOREIGN KEY ("aiInteractionId") REFERENCES "AiInteraction"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AiSettings" ADD CONSTRAINT "AiSettings_keySetById_fkey" FOREIGN KEY ("keySetById") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AiSettings" ADD CONSTRAINT "AiSettings_updatedById_fkey" FOREIGN KEY ("updatedById") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AiInteraction" ADD CONSTRAINT "AiInteraction_actorUserId_fkey" FOREIGN KEY ("actorUserId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ControlEmbedding" ADD CONSTRAINT "ControlEmbedding_controlId_fkey" FOREIGN KEY ("controlId") REFERENCES "Control"("id") ON DELETE RESTRICT ON UPDATE CASCADE;


-- Check constraints (Prisma cannot model them; `migrate diff` ignores them).
ALTER TABLE "AiSettings" ADD CONSTRAINT "AiSettings_singleton_check" CHECK ("singleton");
ALTER TABLE "AiSettings" ADD CONSTRAINT "AiSettings_key_check" CHECK (
  ("sealedKey" IS NULL AND "keyLast4" IS NULL AND "keySetById" IS NULL AND "keySetAt" IS NULL)
  OR ("sealedKey" IS NOT NULL AND "keyLast4" IS NOT NULL AND "keySetById" IS NOT NULL AND "keySetAt" IS NOT NULL)
);
ALTER TABLE "AiSettings" ADD CONSTRAINT "AiSettings_keyLast4_check" CHECK ("keyLast4" IS NULL OR char_length("keyLast4") = 4);
ALTER TABLE "AiSettings" ADD CONSTRAINT "AiSettings_models_check" CHECK (jsonb_typeof("models") = 'object');

ALTER TABLE "AiInteraction" ADD CONSTRAINT "AiInteraction_attempts_check" CHECK ("attempts" BETWEEN 0 AND 10);
ALTER TABLE "AiInteraction" ADD CONSTRAINT "AiInteraction_durationMs_check" CHECK ("durationMs" >= 0);
ALTER TABLE "AiInteraction" ADD CONSTRAINT "AiInteraction_discardedCount_check" CHECK ("discardedCount" >= 0);
ALTER TABLE "AiInteraction" ADD CONSTRAINT "AiInteraction_object_check" CHECK (("objectType" IS NULL) = ("objectId" IS NULL));

-- AI interactions are a record of what was sent and received: the app role may insert and read them,
-- and may later set only the outcome (a person's decision) and the discarded count (set by the worker
-- after validating suggestion codes). New tables got full DML from the init migration's default privileges.
REVOKE UPDATE, DELETE, TRUNCATE ON "AiInteraction" FROM isms_app;
GRANT UPDATE ("outcome", "discardedCount") ON "AiInteraction" TO isms_app;
