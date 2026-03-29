/*
  Warnings:

  - The values [PAID] on the enum `OrderPaymentStatus` will be removed. If these variants are still used in the database, this will fail.
  - The values [CONFIRMED,PAYMENT_PENDING,ADVANCE_RECEIVED,TOKEN_GENERATION,TOKEN_GENERATED,CARD_DESIGN,CARD_DESIGN_READY,CARD_DESIGN_REVISION,SENT_TO_VENDOR,PRINT_COMPLETE,READY_TO_SHIP,OUT_FOR_DELIVERY,BALANCE_PENDING] on the enum `OrderStatus` will be removed. If these variants are still used in the database, this will fail.
  - The values [RAZORPAY] on the enum `PaymentMode` will be removed. If these variants are still used in the database, this will fail.
  - The values [ADVANCE_INVOICE,ADVANCE_PAYMENT,BALANCE_INVOICE,BALANCE_PAYMENT] on the enum `PipelineStepName` will be removed. If these variants are still used in the database, this will fail.
  - You are about to drop the column `advance_invoice_id` on the `CardOrder` table. All the data in the column will be lost.
  - You are about to drop the column `balance_invoice_id` on the `CardOrder` table. All the data in the column will be lost.
  - You are about to drop the column `card_count` on the `CardOrder` table. All the data in the column will be lost.
  - You are about to drop the column `qr_generated` on the `CardOrderItem` table. All the data in the column will be lost.
  - You are about to drop the column `invoice_type` on the `Invoice` table. All the data in the column will be lost.
  - You are about to drop the column `pref_checked` on the `Notification` table. All the data in the column will be lost.
  - You are about to drop the column `provider` on the `Payment` table. All the data in the column will be lost.
  - You are about to drop the column `provider_ref` on the `Payment` table. All the data in the column will be lost.
  - You are about to drop the `OtpLog` table. If the table is not empty, all the data it contains will be lost.
  - A unique constraint covering the columns `[partial_invoice_id]` on the table `CardOrder` will be added. If there are existing duplicate values, this will fail.
  - A unique constraint covering the columns `[final_invoice_id]` on the table `CardOrder` will be added. If there are existing duplicate values, this will fail.
  - A unique constraint covering the columns `[card_number]` on the table `Student` will be added. If there are existing duplicate values, this will fail.
  - A unique constraint covering the columns `[token]` on the table `Student` will be added. If there are existing duplicate values, this will fail.
  - A unique constraint covering the columns `[token_hash]` on the table `Student` will be added. If there are existing duplicate values, this will fail.
  - Added the required column `student_count` to the `CardOrder` table without a default value. This is not possible if the table is not empty.
  - Added the required column `category` to the `Invoice` table without a default value. This is not possible if the table is not empty.
  - Added the required column `recipient` to the `Notification` table without a default value. This is not possible if the table is not empty.
  - Changed the type of `type` on the `Notification` table. No cast exists, the column would be dropped and recreated, which cannot be done if there is data, since the column is required.

*/
-- CreateEnum
CREATE TYPE "InvoiceCategory" AS ENUM ('ORDER_INVOICE', 'RENEWAL_INVOICE');

-- CreateEnum
CREATE TYPE "OrderInvoiceType" AS ENUM ('PARTIAL', 'FINAL');

-- CreateEnum
CREATE TYPE "RenewalInvoiceType" AS ENUM ('RENEWAL');

-- CreateEnum
CREATE TYPE "DashboardUserType" AS ENUM ('SUPER_ADMIN', 'SCHOOL_ADMIN');

-- CreateEnum
CREATE TYPE "DashboardNotificationType" AS ENUM ('ORDER_PLACED', 'ORDER_CONFIRMED', 'TOKEN_GENERATION_COMPLETE', 'DESIGN_READY_FOR_APPROVAL', 'CARD_DESIGN_READY', 'CARDS_SHIPPED', 'CARDS_DELIVERED', 'PARTIAL_INVOICE_GENERATED', 'INVOICE_GENERATED', 'PIPELINE_STALLED', 'DLQ_NEW_ENTRY', 'EMERGENCY_FIRED');

-- CreateEnum
CREATE TYPE "ScanType" AS ENUM ('EMERGENCY', 'CHECK_IN', 'ATTENDANCE', 'OTHER');

-- CreateEnum
CREATE TYPE "PipelineStatus" AS ENUM ('PENDING', 'IN_PROGRESS', 'COMPLETE', 'FAILED');

-- CreateEnum
CREATE TYPE "DesignStatus" AS ENUM ('PENDING', 'IN_PROGRESS', 'COMPLETE', 'FAILED');

-- AlterEnum
ALTER TYPE "NotificationChannel" ADD VALUE 'WHATSAPP';

-- AlterEnum
BEGIN;
CREATE TYPE "OrderPaymentStatus_new" AS ENUM ('UNPAID', 'PARTIALLY_PAID', 'FULLY_PAID', 'REFUNDED');
ALTER TABLE "public"."CardOrder" ALTER COLUMN "payment_status" DROP DEFAULT;
ALTER TABLE "CardOrder" ALTER COLUMN "payment_status" TYPE "OrderPaymentStatus_new" USING ("payment_status"::text::"OrderPaymentStatus_new");
ALTER TYPE "OrderPaymentStatus" RENAME TO "OrderPaymentStatus_old";
ALTER TYPE "OrderPaymentStatus_new" RENAME TO "OrderPaymentStatus";
DROP TYPE "public"."OrderPaymentStatus_old";
ALTER TABLE "CardOrder" ALTER COLUMN "payment_status" SET DEFAULT 'UNPAID';
COMMIT;

-- AlterEnum
BEGIN;
CREATE TYPE "OrderStatus_new" AS ENUM ('PENDING', 'PARTIAL_PAYMENT_CONFIRMED', 'PARTIAL_INVOICE_GENERATED', 'TOKEN_GENERATING', 'TOKEN_COMPLETE', 'DESIGN_GENERATING', 'DESIGN_COMPLETE', 'DESIGN_APPROVED', 'VENDOR_SENT', 'PRINTING', 'SHIPPED', 'DELIVERED', 'COMPLETED', 'CANCELLED', 'REFUNDED');
ALTER TABLE "public"."CardOrder" ALTER COLUMN "status" DROP DEFAULT;
ALTER TABLE "CardOrder" ALTER COLUMN "status" TYPE "OrderStatus_new" USING ("status"::text::"OrderStatus_new");
ALTER TABLE "OrderStatusLog" ALTER COLUMN "from_status" TYPE "OrderStatus_new" USING ("from_status"::text::"OrderStatus_new");
ALTER TABLE "OrderStatusLog" ALTER COLUMN "to_status" TYPE "OrderStatus_new" USING ("to_status"::text::"OrderStatus_new");
ALTER TYPE "OrderStatus" RENAME TO "OrderStatus_old";
ALTER TYPE "OrderStatus_new" RENAME TO "OrderStatus";
DROP TYPE "public"."OrderStatus_old";
ALTER TABLE "CardOrder" ALTER COLUMN "status" SET DEFAULT 'PENDING';
COMMIT;

-- AlterEnum
BEGIN;
CREATE TYPE "PaymentMode_new" AS ENUM ('BANK_TRANSFER', 'UPI', 'CHEQUE', 'CASH');
ALTER TABLE "public"."Payment" ALTER COLUMN "payment_mode" DROP DEFAULT;
ALTER TABLE "Payment" ALTER COLUMN "payment_mode" TYPE "PaymentMode_new" USING ("payment_mode"::text::"PaymentMode_new");
ALTER TYPE "PaymentMode" RENAME TO "PaymentMode_old";
ALTER TYPE "PaymentMode_new" RENAME TO "PaymentMode";
DROP TYPE "public"."PaymentMode_old";
ALTER TABLE "Payment" ALTER COLUMN "payment_mode" SET DEFAULT 'BANK_TRANSFER';
COMMIT;

-- AlterEnum
BEGIN;
CREATE TYPE "PipelineStepName_new" AS ENUM ('CREATE', 'CONFIRM', 'PARTIAL_INVOICE', 'PARTIAL_PAYMENT', 'TOKEN_GENERATION', 'CARD_DESIGN', 'VENDOR_DISPATCH', 'PRINTING_START', 'PRINTING_DONE', 'SHIPMENT_CREATE', 'SHIPMENT_SHIPPED', 'DELIVERY', 'FINAL_INVOICE', 'FINAL_PAYMENT', 'CANCEL', 'REFUND');
ALTER TABLE "OrderPipeline" ALTER COLUMN "current_step" TYPE "PipelineStepName_new" USING ("current_step"::text::"PipelineStepName_new");
ALTER TABLE "OrderStepExecution" ALTER COLUMN "step" TYPE "PipelineStepName_new" USING ("step"::text::"PipelineStepName_new");
ALTER TYPE "PipelineStepName" RENAME TO "PipelineStepName_old";
ALTER TYPE "PipelineStepName_new" RENAME TO "PipelineStepName";
DROP TYPE "public"."PipelineStepName_old";
COMMIT;

-- DropForeignKey
ALTER TABLE "CardOrder" DROP CONSTRAINT "CardOrder_advance_invoice_id_fkey";

-- DropForeignKey
ALTER TABLE "CardOrder" DROP CONSTRAINT "CardOrder_balance_invoice_id_fkey";

-- DropIndex
DROP INDEX "CardOrder_advance_invoice_id_key";

-- DropIndex
DROP INDEX "CardOrder_balance_invoice_id_key";

-- DropIndex
DROP INDEX "Invoice_invoice_type_status_idx";

-- DropIndex
DROP INDEX "Payment_provider_ref_key";

-- AlterTable
ALTER TABLE "CardOrder" DROP COLUMN "advance_invoice_id",
DROP COLUMN "balance_invoice_id",
DROP COLUMN "card_count",
ADD COLUMN     "design_completed_count" INTEGER NOT NULL DEFAULT 0,
ADD COLUMN     "design_started_at" TIMESTAMP(3),
ADD COLUMN     "final_invoice_id" TEXT,
ADD COLUMN     "partial_invoice_id" TEXT,
ADD COLUMN     "pipeline_completed_count" INTEGER NOT NULL DEFAULT 0,
ADD COLUMN     "pipeline_started_at" TIMESTAMP(3),
ADD COLUMN     "student_count" INTEGER NOT NULL;

-- AlterTable
ALTER TABLE "CardOrderItem" DROP COLUMN "qr_generated",
ADD COLUMN     "pipeline_status" "PipelineStatus" NOT NULL DEFAULT 'PENDING';

-- AlterTable
ALTER TABLE "Invoice" DROP COLUMN "invoice_type",
ADD COLUMN     "category" "InvoiceCategory" NOT NULL,
ADD COLUMN     "order_invoice_type" "OrderInvoiceType",
ADD COLUMN     "pdf_generated_at" TIMESTAMP(3),
ADD COLUMN     "renewal_invoice_type" "RenewalInvoiceType";

-- AlterTable
ALTER TABLE "Notification" DROP COLUMN "pref_checked",
ADD COLUMN     "content" TEXT,
ADD COLUMN     "recipient" TEXT NOT NULL,
ADD COLUMN     "subject" TEXT,
DROP COLUMN "type",
ADD COLUMN     "type" TEXT NOT NULL;

-- AlterTable
ALTER TABLE "OrderStatusLog" ADD COLUMN     "actor_type" "ActorType" NOT NULL DEFAULT 'SYSTEM';

-- AlterTable
ALTER TABLE "Payment" DROP COLUMN "provider",
DROP COLUMN "provider_ref";

-- AlterTable
ALTER TABLE "ScanLog" ADD COLUMN     "device_info" JSONB,
ADD COLUMN     "dispatched_at" TIMESTAMP(3),
ADD COLUMN     "dispatched_channels" TEXT[] DEFAULT ARRAY[]::TEXT[],
ADD COLUMN     "emergency_dispatched" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN     "failed_channels" TEXT[] DEFAULT ARRAY[]::TEXT[],
ADD COLUMN     "scan_type" "ScanType" NOT NULL DEFAULT 'OTHER',
ADD COLUMN     "scanned_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
ADD COLUMN     "scanned_by" TEXT,
ADD COLUMN     "student_id" TEXT;

-- AlterTable
ALTER TABLE "Student" ADD COLUMN     "card_design_url" TEXT,
ADD COLUMN     "card_number" TEXT,
ADD COLUMN     "design_completed_at" TIMESTAMP(3),
ADD COLUMN     "design_started_at" TIMESTAMP(3),
ADD COLUMN     "design_status" "DesignStatus" DEFAULT 'PENDING',
ADD COLUMN     "pipeline_completed_at" TIMESTAMP(3),
ADD COLUMN     "pipeline_started_at" TIMESTAMP(3),
ADD COLUMN     "pipeline_status" "PipelineStatus" DEFAULT 'PENDING',
ADD COLUMN     "qr_code_url" TEXT,
ADD COLUMN     "scan_url" TEXT,
ADD COLUMN     "token" TEXT,
ADD COLUMN     "token_hash" TEXT;

-- DropTable
DROP TABLE "OtpLog";

-- DropEnum
DROP TYPE "BatchPaymentStatus";

-- DropEnum
DROP TYPE "InvoiceType";

-- DropEnum
DROP TYPE "NotificationType";

-- CreateTable
CREATE TABLE "OtpAuditLog" (
    "id" TEXT NOT NULL,
    "phone" TEXT NOT NULL,
    "purpose" "OtpPurpose" NOT NULL,
    "attempts" INTEGER NOT NULL DEFAULT 0,
    "max_attempts" INTEGER NOT NULL DEFAULT 5,
    "verified" BOOLEAN NOT NULL DEFAULT false,
    "verified_at" TIMESTAMP(3),
    "expires_at" TIMESTAMP(3) NOT NULL,
    "invalidated" BOOLEAN NOT NULL DEFAULT false,
    "msg91_req_id" TEXT,
    "ip_address" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "OtpAuditLog_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "DashboardNotification" (
    "id" TEXT NOT NULL,
    "user_id" TEXT NOT NULL,
    "user_type" "DashboardUserType" NOT NULL,
    "type" "DashboardNotificationType" NOT NULL,
    "title" TEXT NOT NULL,
    "body" TEXT NOT NULL,
    "metadata" JSONB,
    "read" BOOLEAN NOT NULL DEFAULT false,
    "read_at" TIMESTAMP(3),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "school_id" TEXT,
    "order_id" TEXT,
    "school_user_id" TEXT,
    "super_admin_id" TEXT,

    CONSTRAINT "DashboardNotification_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "OtpAuditLog_phone_purpose_idx" ON "OtpAuditLog"("phone", "purpose");

-- CreateIndex
CREATE INDEX "OtpAuditLog_expires_at_idx" ON "OtpAuditLog"("expires_at");

-- CreateIndex
CREATE INDEX "DashboardNotification_user_id_user_type_idx" ON "DashboardNotification"("user_id", "user_type");

-- CreateIndex
CREATE INDEX "DashboardNotification_user_id_read_idx" ON "DashboardNotification"("user_id", "read");

-- CreateIndex
CREATE INDEX "DashboardNotification_user_id_created_at_idx" ON "DashboardNotification"("user_id", "created_at");

-- CreateIndex
CREATE INDEX "DashboardNotification_type_created_at_idx" ON "DashboardNotification"("type", "created_at");

-- CreateIndex
CREATE INDEX "DashboardNotification_school_id_idx" ON "DashboardNotification"("school_id");

-- CreateIndex
CREATE INDEX "Card_card_number_idx" ON "Card"("card_number");

-- CreateIndex
CREATE UNIQUE INDEX "CardOrder_partial_invoice_id_key" ON "CardOrder"("partial_invoice_id");

-- CreateIndex
CREATE UNIQUE INDEX "CardOrder_final_invoice_id_key" ON "CardOrder"("final_invoice_id");

-- CreateIndex
CREATE INDEX "Invoice_category_order_invoice_type_idx" ON "Invoice"("category", "order_invoice_type");

-- CreateIndex
CREATE INDEX "Invoice_status_idx" ON "Invoice"("status");

-- CreateIndex
CREATE INDEX "Invoice_invoice_number_idx" ON "Invoice"("invoice_number");

-- CreateIndex
CREATE INDEX "Notification_channel_status_idx" ON "Notification"("channel", "status");

-- CreateIndex
CREATE INDEX "ScanLog_student_id_created_at_idx" ON "ScanLog"("student_id", "created_at");

-- CreateIndex
CREATE INDEX "ScanLog_scan_type_created_at_idx" ON "ScanLog"("scan_type", "created_at");

-- CreateIndex
CREATE INDEX "ScanLog_emergency_dispatched_dispatched_at_idx" ON "ScanLog"("emergency_dispatched", "dispatched_at");

-- CreateIndex
CREATE UNIQUE INDEX "Student_card_number_key" ON "Student"("card_number");

-- CreateIndex
CREATE UNIQUE INDEX "Student_token_key" ON "Student"("token");

-- CreateIndex
CREATE UNIQUE INDEX "Student_token_hash_key" ON "Student"("token_hash");

-- CreateIndex
CREATE INDEX "Student_pipeline_status_idx" ON "Student"("pipeline_status");

-- CreateIndex
CREATE INDEX "Student_card_number_idx" ON "Student"("card_number");

-- CreateIndex
CREATE INDEX "Student_token_hash_idx" ON "Student"("token_hash");

-- CreateIndex
CREATE INDEX "Token_student_id_idx" ON "Token"("student_id");

-- AddForeignKey
ALTER TABLE "CardOrder" ADD CONSTRAINT "CardOrder_partial_invoice_id_fkey" FOREIGN KEY ("partial_invoice_id") REFERENCES "Invoice"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CardOrder" ADD CONSTRAINT "CardOrder_final_invoice_id_fkey" FOREIGN KEY ("final_invoice_id") REFERENCES "Invoice"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CardOrderItem" ADD CONSTRAINT "CardOrderItem_student_id_fkey" FOREIGN KEY ("student_id") REFERENCES "Student"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Invoice" ADD CONSTRAINT "Invoice_subscription_id_fkey" FOREIGN KEY ("subscription_id") REFERENCES "Subscription"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "DashboardNotification" ADD CONSTRAINT "DashboardNotification_school_id_fkey" FOREIGN KEY ("school_id") REFERENCES "School"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "DashboardNotification" ADD CONSTRAINT "DashboardNotification_order_id_fkey" FOREIGN KEY ("order_id") REFERENCES "CardOrder"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "DashboardNotification" ADD CONSTRAINT "DashboardNotification_school_user_id_fkey" FOREIGN KEY ("school_user_id") REFERENCES "SchoolUser"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "DashboardNotification" ADD CONSTRAINT "DashboardNotification_super_admin_id_fkey" FOREIGN KEY ("super_admin_id") REFERENCES "SuperAdmin"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ScanLog" ADD CONSTRAINT "ScanLog_student_id_fkey" FOREIGN KEY ("student_id") REFERENCES "Student"("id") ON DELETE SET NULL ON UPDATE CASCADE;
