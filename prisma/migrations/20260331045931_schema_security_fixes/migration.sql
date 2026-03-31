/*
  Warnings:

  - You are about to drop the column `phone` on the `OtpAuditLog` table. All the data in the column will be lost.
  - A unique constraint covering the columns `[profile_id,priority]` on the table `EmergencyContact` will be added. If there are existing duplicate values, this will fail.
  - Added the required column `phone_index` to the `OtpAuditLog` table without a default value. This is not possible if the table is not empty.

*/
-- DropIndex
DROP INDEX "EmergencyContact_profile_id_priority_idx";

-- DropIndex
DROP INDEX "IdempotencyKey_key_idx";

-- DropIndex
DROP INDEX "OtpAuditLog_phone_purpose_idx";

-- AlterTable
ALTER TABLE "OtpAuditLog" DROP COLUMN "phone",
ADD COLUMN     "phone_index" TEXT NOT NULL;

-- CreateIndex
CREATE INDEX "EmergencyContact_profile_id_idx" ON "EmergencyContact"("profile_id");

-- CreateIndex
CREATE UNIQUE INDEX "EmergencyContact_profile_id_priority_key" ON "EmergencyContact"("profile_id", "priority");

-- CreateIndex
CREATE INDEX "OtpAuditLog_phone_index_purpose_idx" ON "OtpAuditLog"("phone_index", "purpose");

-- AddForeignKey
ALTER TABLE "DeviceLoginLog" ADD CONSTRAINT "DeviceLoginLog_parent_id_fkey" FOREIGN KEY ("parent_id") REFERENCES "ParentUser"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- Enforce exactly one session owner at DB level
ALTER TABLE "Session"
ADD CONSTRAINT chk_session_single_owner CHECK (
  (
    (admin_user_id IS NOT NULL)::int +
    (school_user_id IS NOT NULL)::int +
    (parent_user_id IS NOT NULL)::int
  ) = 1
);
