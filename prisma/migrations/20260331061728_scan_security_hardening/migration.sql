/*
  Warnings:

  - The values [EXPIRED] on the enum `ScanResult` will be removed. If these variants are still used in the database, this will fail.
  - The `scan_purpose` column on the `ScanLog` table would be dropped and recreated. This will lead to data loss if there is data in the column.

*/
-- CreateEnum
CREATE TYPE "ScanPurpose" AS ENUM ('EMERGENCY', 'CHECK_IN', 'ROUTINE', 'UNKNOWN');

-- AlterEnum
BEGIN;
CREATE TYPE "ScanResult_new" AS ENUM ('SUCCESS', 'INVALID', 'REVOKED', 'EXPIREDf', 'INACTIVE', 'RATE_LIMITED', 'ERROR', 'UNREGISTERED', 'PENDING');
ALTER TABLE "ScanLog" ALTER COLUMN "result" TYPE "ScanResult_new" USING ("result"::text::"ScanResult_new");
ALTER TYPE "ScanResult" RENAME TO "ScanResult_old";
ALTER TYPE "ScanResult_new" RENAME TO "ScanResult";
DROP TYPE "public"."ScanResult_old";
COMMIT;

-- DropForeignKey
ALTER TABLE "ScanLog" DROP CONSTRAINT "ScanLog_school_id_fkey";

-- DropForeignKey
ALTER TABLE "ScanLog" DROP CONSTRAINT "ScanLog_token_id_fkey";

-- AlterTable
ALTER TABLE "ScanLog" ADD COLUMN     "anomaly_score" INTEGER NOT NULL DEFAULT 0,
ALTER COLUMN "token_id" DROP NOT NULL,
ALTER COLUMN "school_id" DROP NOT NULL,
ALTER COLUMN "location_derived" SET DEFAULT false,
DROP COLUMN "scan_purpose",
ADD COLUMN     "scan_purpose" "ScanPurpose";

-- AlterTable
ALTER TABLE "ScanRateLimit" ADD COLUMN     "metadata" JSONB;

-- AlterTable
ALTER TABLE "Token" ADD COLUMN     "is_honeypot" BOOLEAN NOT NULL DEFAULT false;

-- CreateIndex
CREATE INDEX "RegistrationNonce_token_id_used_expires_at_idx" ON "RegistrationNonce"("token_id", "used", "expires_at");

-- CreateIndex
CREATE INDEX "ScanLog_anomaly_score_idx" ON "ScanLog"("anomaly_score");

-- CreateIndex
CREATE INDEX "Token_is_honeypot_idx" ON "Token"("is_honeypot");

-- AddForeignKey
ALTER TABLE "ScanLog" ADD CONSTRAINT "ScanLog_token_id_fkey" FOREIGN KEY ("token_id") REFERENCES "Token"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ScanLog" ADD CONSTRAINT "ScanLog_school_id_fkey" FOREIGN KEY ("school_id") REFERENCES "School"("id") ON DELETE SET NULL ON UPDATE CASCADE;
