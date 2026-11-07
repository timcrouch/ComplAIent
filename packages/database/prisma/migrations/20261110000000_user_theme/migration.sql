-- Issue #2: the colour theme belongs to the user, not the browser. NULL means "system".

-- CreateEnum
CREATE TYPE "ColourTheme" AS ENUM ('light', 'dark', 'system');

-- AlterTable
ALTER TABLE "User" ADD COLUMN     "theme" "ColourTheme";
