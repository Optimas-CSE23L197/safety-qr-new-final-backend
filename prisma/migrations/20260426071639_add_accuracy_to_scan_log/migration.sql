-- DropIndex
DROP INDEX "Subscription_school_id_idx";

-- AlterTable
ALTER TABLE "ScanLog" ADD COLUMN     "accuracy" DOUBLE PRECISION;

-- CreateIndex
CREATE INDEX "Subscription_school_id_status_idx" ON "Subscription"("school_id", "status");
