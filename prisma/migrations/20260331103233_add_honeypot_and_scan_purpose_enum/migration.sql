/*
  Warnings:

  - The values [EMERGENCY,CHECK_IN,ROUTINE,UNKNOWN] on the enum `ScanPurpose` will be removed. If these variants are still used in the database, this will fail.
  - The values [EXPIREDf,PENDING] on the enum `ScanResult` will be removed. If these variants are still used in the database, this will fail.
  - You are about to drop the column `anomaly_score` on the `ScanLog` table. All the data in the column will be lost.
  - You are about to drop the column `metadata` on the `ScanRateLimit` table. All the data in the column will be lost.
  - Made the column `token_id` on table `ScanLog` required. This step will fail if there are existing NULL values in that column.
  - Made the column `school_id` on table `ScanLog` required. This step will fail if there are existing NULL values in that column.
  - Made the column `scan_purpose` on table `ScanLog` required. This step will fail if there are existing NULL values in that column.

*/
-- AlterEnum
BEGIN;
CREATE TYPE "ScanPurpose_new" AS ENUM ('QR_SCAN', 'MANUAL_LOOKUP', 'HONEYPOT');
ALTER TABLE "ScanLog" ALTER COLUMN "scan_purpose" TYPE "ScanPurpose_new" USING ("scan_purpose"::text::"ScanPurpose_new");
ALTER TYPE "ScanPurpose" RENAME TO "ScanPurpose_old";
ALTER TYPE "ScanPurpose_new" RENAME TO "ScanPurpose";
DROP TYPE "public"."ScanPurpose_old";
COMMIT;

-- AlterEnum
BEGIN;
CREATE TYPE "ScanResult_new" AS ENUM ('SUCCESS', 'INVALID', 'REVOKED', 'EXPIRED', 'INACTIVE', 'UNREGISTERED', 'ISSUED', 'RATE_LIMITED', 'ERROR');
ALTER TABLE "ScanLog" ALTER COLUMN "result" TYPE "ScanResult_new" USING ("result"::text::"ScanResult_new");
ALTER TYPE "ScanResult" RENAME TO "ScanResult_old";
ALTER TYPE "ScanResult_new" RENAME TO "ScanResult";
DROP TYPE "public"."ScanResult_old";
COMMIT;

-- DropForeignKey
ALTER TABLE "ScanLog" DROP CONSTRAINT "ScanLog_school_id_fkey";

-- DropForeignKey
ALTER TABLE "ScanLog" DROP CONSTRAINT "ScanLog_token_id_fkey";

-- DropIndex
DROP INDEX "RegistrationNonce_token_id_used_expires_at_idx";

-- DropIndex
DROP INDEX "ScanLog_anomaly_score_idx";

-- AlterTable
ALTER TABLE "ScanLog" DROP COLUMN "anomaly_score",
ALTER COLUMN "token_id" SET NOT NULL,
ALTER COLUMN "school_id" SET NOT NULL,
ALTER COLUMN "location_derived" SET DEFAULT true,
ALTER COLUMN "scan_purpose" SET NOT NULL,
ALTER COLUMN "scan_purpose" SET DEFAULT 'QR_SCAN';

-- AlterTable
ALTER TABLE "ScanRateLimit" DROP COLUMN "metadata";

-- AddForeignKey
ALTER TABLE "ScanLog" ADD CONSTRAINT "ScanLog_token_id_fkey" FOREIGN KEY ("token_id") REFERENCES "Token"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ScanLog" ADD CONSTRAINT "ScanLog_school_id_fkey" FOREIGN KEY ("school_id") REFERENCES "School"("id") ON DELETE CASCADE ON UPDATE CASCADE;
