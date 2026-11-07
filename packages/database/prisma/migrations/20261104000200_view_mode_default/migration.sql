-- The view mode is now chosen by the user; NULL means "use the role default".
-- Plan 1 had no endpoint that wrote it, so every existing value is the old default.
ALTER TABLE "User" ALTER COLUMN "viewMode" DROP DEFAULT;
ALTER TABLE "User" ALTER COLUMN "viewMode" DROP NOT NULL;
UPDATE "User" SET "viewMode" = NULL;
