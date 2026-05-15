-- CreateEnum
CREATE TYPE "CallCategory" AS ENUM ('HOT', 'WARM', 'COLD', 'NO_ANSWER');

-- AlterTable
ALTER TABLE "calls" ADD COLUMN "category" "CallCategory",
  ADD COLUMN "summary_text" TEXT,
  ADD COLUMN "next_step" TEXT,
  ADD COLUMN "lead_name" TEXT,
  ADD COLUMN "classified_at" TIMESTAMP(3);

-- CreateIndex
CREATE INDEX "calls_category_idx" ON "calls"("category");

-- CreateIndex
CREATE INDEX "calls_tenant_id_category_started_at_idx" ON "calls"("tenant_id", "category", "started_at");
