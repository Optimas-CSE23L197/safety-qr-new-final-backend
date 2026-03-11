/*
  Warnings:

  - The values [TRIAL,BASIC,PREMIUM] on the enum `PlanType` will be removed. If these variants are still used in the database, this will fail.
  - A unique constraint covering the columns `[udise_code]` on the table `School` will be added. If there are existing duplicate values, this will fail.

*/
-- CreateEnum
CREATE TYPE "SchoolType" AS ENUM ('GOVERNMENT', 'PRIVATE', 'INTERNATIONAL', 'NGO');

-- CreateEnum
CREATE TYPE "PricingTier" AS ENUM ('GOVT_STANDARD', 'PRIVATE_STANDARD', 'ENTERPRISE', 'FREE_PILOT');

-- CreateEnum
CREATE TYPE "InvoiceType" AS ENUM ('ORDER', 'ADVANCE', 'BALANCE', 'RENEWAL', 'CUSTOM');

-- CreateEnum
CREATE TYPE "PaymentMode" AS ENUM ('BANK_TRANSFER', 'UPI', 'CHEQUE', 'RAZORPAY', 'CASH');

-- CreateEnum
CREATE TYPE "BatchPaymentStatus" AS ENUM ('PENDING', 'PARTIALLY_PAID', 'PAID', 'OVERDUE', 'CANCELLED');

-- AlterEnum
-- This migration adds more than one value to an enum.
-- With PostgreSQL versions 11 and earlier, this is not possible
-- in a single migration. This can be worked around by creating
-- multiple migrations, each migration adding only one value to
-- the enum.


ALTER TYPE "OtpPurpose" ADD VALUE 'CARD_REPLACEMENT';
ALTER TYPE "OtpPurpose" ADD VALUE 'CHANGE_PIN';

-- AlterEnum
-- This migration adds more than one value to an enum.
-- With PostgreSQL versions 11 and earlier, this is not possible
-- in a single migration. This can be worked around by creating
-- multiple migrations, each migration adding only one value to
-- the enum.


ALTER TYPE "ParentEditType" ADD VALUE 'CARD_BLOCK';
ALTER TYPE "ParentEditType" ADD VALUE 'CARD_REPLACEMENT';

-- AlterEnum
BEGIN;
CREATE TYPE "PlanType_new" AS ENUM ('FREE_PILOT', 'GOVT_STANDARD', 'PRIVATE_STANDARD', 'ENTERPRISE');
ALTER TABLE "public"."Subscription" ALTER COLUMN "plan" DROP DEFAULT;
ALTER TABLE "Subscription" ALTER COLUMN "plan" TYPE "PlanType_new" USING ("plan"::text::"PlanType_new");
ALTER TYPE "PlanType" RENAME TO "PlanType_old";
ALTER TYPE "PlanType_new" RENAME TO "PlanType";
DROP TYPE "public"."PlanType_old";
ALTER TABLE "Subscription" ALTER COLUMN "plan" SET DEFAULT 'GOVT_STANDARD';
COMMIT;

-- AlterTable
ALTER TABLE "CardOrder" ADD COLUMN     "advance_amount" INTEGER,
ADD COLUMN     "advance_paid_at" TIMESTAMP(3),
ADD COLUMN     "balance_amount" INTEGER,
ADD COLUMN     "balance_due_at" TIMESTAMP(3),
ADD COLUMN     "balance_paid_at" TIMESTAMP(3),
ADD COLUMN     "pricing_tier" "PricingTier",
ADD COLUMN     "school_type" "SchoolType";

-- AlterTable
ALTER TABLE "CardRenewal" ADD COLUMN     "pricing_tier" "PricingTier",
ADD COLUMN     "school_type" "SchoolType";

-- AlterTable
ALTER TABLE "Invoice" ADD COLUMN     "invoice_type" "InvoiceType" NOT NULL DEFAULT 'ORDER',
ADD COLUMN     "student_count" INTEGER,
ADD COLUMN     "subscription_id" TEXT,
ADD COLUMN     "unit_price" INTEGER;

-- AlterTable
ALTER TABLE "School" ADD COLUMN     "affiliated_board" TEXT,
ADD COLUMN     "affiliation_num" TEXT,
ADD COLUMN     "contract_expires_at" TIMESTAMP(3),
ADD COLUMN     "contract_signed_at" TIMESTAMP(3),
ADD COLUMN     "onboarded_at" TIMESTAMP(3),
ADD COLUMN     "onboarded_by" TEXT,
ADD COLUMN     "pincode" TEXT,
ADD COLUMN     "pricing_tier" "PricingTier" NOT NULL DEFAULT 'PRIVATE_STANDARD',
ADD COLUMN     "school_type" "SchoolType" NOT NULL DEFAULT 'PRIVATE',
ADD COLUMN     "state" TEXT,
ADD COLUMN     "udise_code" TEXT;

-- AlterTable
ALTER TABLE "Subscription" ADD COLUMN     "advance_paid" INTEGER NOT NULL DEFAULT 0,
ADD COLUMN     "balance_due" INTEGER NOT NULL DEFAULT 0,
ADD COLUMN     "pricing_tier" "PricingTier" NOT NULL DEFAULT 'PRIVATE_STANDARD',
ADD COLUMN     "renewal_price" INTEGER NOT NULL DEFAULT 10000,
ADD COLUMN     "school_type" "SchoolType" NOT NULL DEFAULT 'PRIVATE',
ADD COLUMN     "student_count" INTEGER NOT NULL DEFAULT 0,
ADD COLUMN     "total_amount" INTEGER NOT NULL DEFAULT 0,
ADD COLUMN     "unit_price" INTEGER NOT NULL DEFAULT 19900,
ALTER COLUMN "plan" SET DEFAULT 'GOVT_STANDARD';

-- CreateTable
CREATE TABLE "SchoolPaymentBatch" (
    "id" TEXT NOT NULL,
    "school_id" TEXT NOT NULL,
    "subscription_id" TEXT,
    "batch_number" TEXT NOT NULL,
    "student_count" INTEGER NOT NULL,
    "unit_price" INTEGER NOT NULL,
    "subtotal" INTEGER NOT NULL,
    "tax_amount" INTEGER NOT NULL DEFAULT 0,
    "total_amount" INTEGER NOT NULL,
    "amount_received" INTEGER NOT NULL DEFAULT 0,
    "payment_ref" TEXT,
    "payment_mode" "PaymentMode" NOT NULL DEFAULT 'BANK_TRANSFER',
    "status" "BatchPaymentStatus" NOT NULL DEFAULT 'PENDING',
    "is_advance" BOOLEAN NOT NULL DEFAULT false,
    "notes" TEXT,
    "received_at" TIMESTAMP(3),
    "verified_by" TEXT,
    "verified_at" TIMESTAMP(3),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "SchoolPaymentBatch_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "SchoolPaymentBatch_batch_number_key" ON "SchoolPaymentBatch"("batch_number");

-- CreateIndex
CREATE INDEX "SchoolPaymentBatch_school_id_idx" ON "SchoolPaymentBatch"("school_id");

-- CreateIndex
CREATE INDEX "SchoolPaymentBatch_status_idx" ON "SchoolPaymentBatch"("status");

-- CreateIndex
CREATE INDEX "SchoolPaymentBatch_received_at_idx" ON "SchoolPaymentBatch"("received_at");

-- CreateIndex
CREATE INDEX "SchoolPaymentBatch_school_id_status_idx" ON "SchoolPaymentBatch"("school_id", "status");

-- CreateIndex
CREATE INDEX "SchoolPaymentBatch_batch_number_idx" ON "SchoolPaymentBatch"("batch_number");

-- CreateIndex
CREATE UNIQUE INDEX "School_udise_code_key" ON "School"("udise_code");

-- CreateIndex
CREATE INDEX "School_school_type_idx" ON "School"("school_type");

-- CreateIndex
CREATE INDEX "School_pricing_tier_idx" ON "School"("pricing_tier");

-- CreateIndex
CREATE INDEX "School_state_idx" ON "School"("state");

-- CreateIndex
CREATE INDEX "School_school_type_is_active_idx" ON "School"("school_type", "is_active");

-- AddForeignKey
ALTER TABLE "Invoice" ADD CONSTRAINT "Invoice_subscription_id_fkey" FOREIGN KEY ("subscription_id") REFERENCES "Subscription"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SchoolPaymentBatch" ADD CONSTRAINT "SchoolPaymentBatch_school_id_fkey" FOREIGN KEY ("school_id") REFERENCES "School"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SchoolPaymentBatch" ADD CONSTRAINT "SchoolPaymentBatch_subscription_id_fkey" FOREIGN KEY ("subscription_id") REFERENCES "Subscription"("id") ON DELETE SET NULL ON UPDATE CASCADE;
