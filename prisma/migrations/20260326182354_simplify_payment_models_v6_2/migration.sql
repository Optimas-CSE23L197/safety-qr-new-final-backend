/*
  Warnings:

  - The values [STAFF,VIEWER] on the enum `SchoolRole` will be removed. If these variants are still used in the database, this will fail.
  - You are about to drop the column `balance_due_at` on the `CardOrder` table. All the data in the column will be lost.
  - You are about to drop the column `channel` on the `CardOrder` table. All the data in the column will be lost.
  - You are about to drop the column `delivery_notes` on the `CardOrder` table. All the data in the column will be lost.
  - You are about to drop the column `order_mode` on the `CardOrder` table. All the data in the column will be lost.
  - You are about to drop the column `created_at` on the `Invoice` table. All the data in the column will be lost.
  - You are about to drop the column `notes` on the `Invoice` table. All the data in the column will be lost.
  - You are about to drop the column `subscription_id` on the `Invoice` table. All the data in the column will be lost.
  - You are about to drop the column `updated_at` on the `Invoice` table. All the data in the column will be lost.
  - You are about to drop the column `currency` on the `Payment` table. All the data in the column will be lost.
  - You are about to drop the column `failure_reason` on the `Payment` table. All the data in the column will be lost.
  - You are about to drop the column `is_renewal` on the `Payment` table. All the data in the column will be lost.
  - You are about to drop the column `subscription_id` on the `Payment` table. All the data in the column will be lost.
  - You are about to drop the column `tax_amount` on the `Payment` table. All the data in the column will be lost.
  - You are about to drop the column `advance_paid` on the `Subscription` table. All the data in the column will be lost.
  - You are about to drop the column `balance_due` on the `Subscription` table. All the data in the column will be lost.
  - You are about to drop the column `cancel_reason` on the `Subscription` table. All the data in the column will be lost.
  - You are about to drop the column `cancelled_at` on the `Subscription` table. All the data in the column will be lost.
  - You are about to drop the column `provider` on the `Subscription` table. All the data in the column will be lost.
  - You are about to drop the column `provider_sub_id` on the `Subscription` table. All the data in the column will be lost.
  - You are about to drop the column `renewal_price` on the `Subscription` table. All the data in the column will be lost.
  - You are about to drop the column `school_type` on the `Subscription` table. All the data in the column will be lost.
  - You are about to drop the column `tax_amount` on the `Subscription` table. All the data in the column will be lost.
  - You are about to drop the column `total_amount` on the `Subscription` table. All the data in the column will be lost.
  - You are about to drop the `SchoolPaymentBatch` table. If the table is not empty, all the data it contains will be lost.
  - A unique constraint covering the columns `[advance_invoice_id]` on the table `CardOrder` will be added. If there are existing duplicate values, this will fail.
  - A unique constraint covering the columns `[balance_invoice_id]` on the table `CardOrder` will be added. If there are existing duplicate values, this will fail.
  - A unique constraint covering the columns `[order_item_id]` on the table `Token` will be added. If there are existing duplicate values, this will fail.
  - Made the column `student_count` on table `Invoice` required. This step will fail if there are existing NULL values in that column.
  - Made the column `unit_price` on table `Invoice` required. This step will fail if there are existing NULL values in that column.
  - Made the column `issued_at` on table `Invoice` required. This step will fail if there are existing NULL values in that column.
  - Made the column `order_id` on table `Payment` required. This step will fail if there are existing NULL values in that column.

*/
-- AlterEnum
BEGIN;
CREATE TYPE "SchoolRole_new" AS ENUM ('ADMIN');
ALTER TABLE "public"."SchoolUser" ALTER COLUMN "role" DROP DEFAULT;
ALTER TABLE "SchoolUser" ALTER COLUMN "role" TYPE "SchoolRole_new" USING ("role"::text::"SchoolRole_new");
ALTER TYPE "SchoolRole" RENAME TO "SchoolRole_old";
ALTER TYPE "SchoolRole_new" RENAME TO "SchoolRole";
DROP TYPE "public"."SchoolRole_old";
ALTER TABLE "SchoolUser" ALTER COLUMN "role" SET DEFAULT 'ADMIN';
COMMIT;

-- DropForeignKey
ALTER TABLE "CardOrderItem" DROP CONSTRAINT "CardOrderItem_token_id_fkey";

-- DropForeignKey
ALTER TABLE "Invoice" DROP CONSTRAINT "Invoice_subscription_id_fkey";

-- DropForeignKey
ALTER TABLE "Payment" DROP CONSTRAINT "Payment_order_id_fkey";

-- DropForeignKey
ALTER TABLE "Payment" DROP CONSTRAINT "Payment_subscription_id_fkey";

-- DropForeignKey
ALTER TABLE "SchoolPaymentBatch" DROP CONSTRAINT "SchoolPaymentBatch_school_id_fkey";

-- DropForeignKey
ALTER TABLE "SchoolPaymentBatch" DROP CONSTRAINT "SchoolPaymentBatch_subscription_id_fkey";

-- DropIndex
DROP INDEX "ApiKey_revoked_at_idx";

-- DropIndex
DROP INDEX "AuditLog_action_idx";

-- DropIndex
DROP INDEX "AuditLog_actor_type_created_at_idx";

-- DropIndex
DROP INDEX "Card_print_status_idx";

-- DropIndex
DROP INDEX "Card_student_id_idx";

-- DropIndex
DROP INDEX "CardOrder_channel_idx";

-- DropIndex
DROP INDEX "CardOrder_channel_status_idx";

-- DropIndex
DROP INDEX "CardOrder_order_type_idx";

-- DropIndex
DROP INDEX "CardOrder_school_id_status_idx";

-- DropIndex
DROP INDEX "CardOrder_status_created_at_idx";

-- DropIndex
DROP INDEX "CardOrder_vendor_id_idx";

-- DropIndex
DROP INDEX "CardOrderItem_order_id_card_printed_idx";

-- DropIndex
DROP INDEX "CardOrderItem_order_id_status_idx";

-- DropIndex
DROP INDEX "CardOrderItem_status_idx";

-- DropIndex
DROP INDEX "CardRenewal_created_at_idx";

-- DropIndex
DROP INDEX "CardRenewal_school_id_idx";

-- DropIndex
DROP INDEX "DeadLetterQueue_created_at_idx";

-- DropIndex
DROP INDEX "DeadLetterQueue_job_type_idx";

-- DropIndex
DROP INDEX "DeviceLoginLog_login_at_idx";

-- DropIndex
DROP INDEX "DeviceLoginLog_parent_id_idx";

-- DropIndex
DROP INDEX "EmergencyContact_profile_id_idx";

-- DropIndex
DROP INDEX "EmergencyContact_profile_id_is_active_idx";

-- DropIndex
DROP INDEX "FeatureFlagOverride_expires_at_idx";

-- DropIndex
DROP INDEX "IdempotencyKey_resource_type_resource_id_idx";

-- DropIndex
DROP INDEX "Invoice_issued_at_idx";

-- DropIndex
DROP INDEX "Invoice_school_id_idx";

-- DropIndex
DROP INDEX "Invoice_school_id_status_idx";

-- DropIndex
DROP INDEX "Invoice_status_idx";

-- DropIndex
DROP INDEX "IpBlocklist_ip_address_idx";

-- DropIndex
DROP INDEX "JobExecution_bullmq_job_id_idx";

-- DropIndex
DROP INDEX "JobExecution_status_queued_at_idx";

-- DropIndex
DROP INDEX "LocationEvent_source_idx";

-- DropIndex
DROP INDEX "LocationEvent_student_id_idx";

-- DropIndex
DROP INDEX "LocationEvent_token_id_idx";

-- DropIndex
DROP INDEX "Notification_created_at_idx";

-- DropIndex
DROP INDEX "Notification_parent_id_idx";

-- DropIndex
DROP INDEX "Notification_status_idx";

-- DropIndex
DROP INDEX "Notification_student_id_idx";

-- DropIndex
DROP INDEX "Notification_type_idx";

-- DropIndex
DROP INDEX "OrderShipment_shiprocket_order_id_idx";

-- DropIndex
DROP INDEX "OrderShipment_status_created_at_idx";

-- DropIndex
DROP INDEX "OrderStatusLog_changed_by_idx";

-- DropIndex
DROP INDEX "OrderStatusLog_order_id_idx";

-- DropIndex
DROP INDEX "OrderStatusLog_to_status_created_at_idx";

-- DropIndex
DROP INDEX "OrderStepExecution_status_triggered_at_idx";

-- DropIndex
DROP INDEX "OtpLog_msg91_req_id_idx";

-- DropIndex
DROP INDEX "ParentDevice_parent_id_idx";

-- DropIndex
DROP INDEX "ParentEditLog_field_group_idx";

-- DropIndex
DROP INDEX "ParentEditLog_school_id_idx";

-- DropIndex
DROP INDEX "ParentStudent_parent_id_idx";

-- DropIndex
DROP INDEX "ParentStudent_student_id_idx";

-- DropIndex
DROP INDEX "ParentUser_deleted_at_idx";

-- DropIndex
DROP INDEX "ParentUser_status_idx";

-- DropIndex
DROP INDEX "Payment_school_id_idx";

-- DropIndex
DROP INDEX "Payment_status_idx";

-- DropIndex
DROP INDEX "Payment_subscription_id_idx";

-- DropIndex
DROP INDEX "QrAsset_generated_at_idx";

-- DropIndex
DROP INDEX "QrAsset_is_active_idx";

-- DropIndex
DROP INDEX "QrAsset_qr_type_idx";

-- DropIndex
DROP INDEX "ScanAnomaly_created_at_idx";

-- DropIndex
DROP INDEX "ScanAnomaly_resolved_idx";

-- DropIndex
DROP INDEX "ScanAnomaly_severity_idx";

-- DropIndex
DROP INDEX "ScanLog_created_at_idx";

-- DropIndex
DROP INDEX "ScanLog_device_hash_idx";

-- DropIndex
DROP INDEX "ScanLog_ip_address_idx";

-- DropIndex
DROP INDEX "ScanLog_result_created_at_idx";

-- DropIndex
DROP INDEX "ScanLog_result_idx";

-- DropIndex
DROP INDEX "ScanLog_token_id_idx";

-- DropIndex
DROP INDEX "ScanRateLimit_identifier_identifier_type_idx";

-- DropIndex
DROP INDEX "ScanRateLimit_window_start_idx";

-- DropIndex
DROP INDEX "School_pricing_tier_idx";

-- DropIndex
DROP INDEX "School_school_type_idx";

-- DropIndex
DROP INDEX "School_school_type_is_active_idx";

-- DropIndex
DROP INDEX "School_state_idx";

-- DropIndex
DROP INDEX "SchoolSettings_school_id_allow_location_idx";

-- DropIndex
DROP INDEX "SchoolUser_school_id_is_active_idx";

-- DropIndex
DROP INDEX "Session_is_active_idx";

-- DropIndex
DROP INDEX "Session_last_active_at_idx";

-- DropIndex
DROP INDEX "Session_parent_user_id_idx";

-- DropIndex
DROP INDEX "Session_school_user_id_idx";

-- DropIndex
DROP INDEX "Student_deleted_at_idx";

-- DropIndex
DROP INDEX "Student_school_id_is_active_idx";

-- DropIndex
DROP INDEX "Student_school_id_profile_type_idx";

-- DropIndex
DROP INDEX "Subscription_current_period_end_idx";

-- DropIndex
DROP INDEX "Subscription_provider_sub_id_key";

-- DropIndex
DROP INDEX "SuperAdmin_is_active_idx";

-- DropIndex
DROP INDEX "Token_batch_id_idx";

-- DropIndex
DROP INDEX "Token_expires_at_idx";

-- DropIndex
DROP INDEX "Token_school_id_idx";

-- DropIndex
DROP INDEX "Token_status_idx";

-- DropIndex
DROP INDEX "Token_student_id_idx";

-- DropIndex
DROP INDEX "TokenBatch_school_id_created_at_idx";

-- DropIndex
DROP INDEX "TokenBatch_school_id_idx";

-- DropIndex
DROP INDEX "TrustedScanZone_school_id_idx";

-- DropIndex
DROP INDEX "Webhook_school_id_idx";

-- DropIndex
DROP INDEX "WebhookDelivery_webhook_id_idx";

-- DropIndex
DROP INDEX "WebhookEvent_received_at_idx";

-- AlterTable
ALTER TABLE "CardOrder" DROP COLUMN "balance_due_at",
DROP COLUMN "channel",
DROP COLUMN "delivery_notes",
DROP COLUMN "order_mode",
ADD COLUMN     "grand_total" INTEGER,
ADD COLUMN     "unit_price" INTEGER;

-- AlterTable
ALTER TABLE "Invoice" DROP COLUMN "created_at",
DROP COLUMN "notes",
DROP COLUMN "subscription_id",
DROP COLUMN "updated_at",
ADD COLUMN     "order_id" TEXT,
ALTER COLUMN "invoice_type" DROP DEFAULT,
ALTER COLUMN "student_count" SET NOT NULL,
ALTER COLUMN "unit_price" SET NOT NULL,
ALTER COLUMN "tax_amount" DROP DEFAULT,
ALTER COLUMN "status" SET DEFAULT 'ISSUED',
ALTER COLUMN "issued_at" SET NOT NULL,
ALTER COLUMN "issued_at" SET DEFAULT CURRENT_TIMESTAMP;

-- AlterTable
ALTER TABLE "Payment" DROP COLUMN "currency",
DROP COLUMN "failure_reason",
DROP COLUMN "is_renewal",
DROP COLUMN "subscription_id",
DROP COLUMN "tax_amount",
ALTER COLUMN "order_id" SET NOT NULL,
ALTER COLUMN "status" SET DEFAULT 'SUCCESS',
ALTER COLUMN "is_advance" SET DEFAULT true;

-- AlterTable
ALTER TABLE "Subscription" DROP COLUMN "advance_paid",
DROP COLUMN "balance_due",
DROP COLUMN "cancel_reason",
DROP COLUMN "cancelled_at",
DROP COLUMN "provider",
DROP COLUMN "provider_sub_id",
DROP COLUMN "renewal_price",
DROP COLUMN "school_type",
DROP COLUMN "tax_amount",
DROP COLUMN "total_amount";

-- DropTable
DROP TABLE "SchoolPaymentBatch";

-- CreateIndex
CREATE UNIQUE INDEX "CardOrder_advance_invoice_id_key" ON "CardOrder"("advance_invoice_id");

-- CreateIndex
CREATE UNIQUE INDEX "CardOrder_balance_invoice_id_key" ON "CardOrder"("balance_invoice_id");

-- CreateIndex
CREATE INDEX "Invoice_order_id_idx" ON "Invoice"("order_id");

-- CreateIndex
CREATE INDEX "Invoice_invoice_type_status_idx" ON "Invoice"("invoice_type", "status");

-- CreateIndex
CREATE UNIQUE INDEX "Token_order_item_id_key" ON "Token"("order_item_id");

-- CreateIndex
CREATE INDEX "Token_token_hash_idx" ON "Token"("token_hash");

-- AddForeignKey
ALTER TABLE "Token" ADD CONSTRAINT "Token_order_item_id_fkey" FOREIGN KEY ("order_item_id") REFERENCES "CardOrderItem"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Invoice" ADD CONSTRAINT "Invoice_order_id_fkey" FOREIGN KEY ("order_id") REFERENCES "CardOrder"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Payment" ADD CONSTRAINT "Payment_order_id_fkey" FOREIGN KEY ("order_id") REFERENCES "CardOrder"("id") ON DELETE CASCADE ON UPDATE CASCADE;
