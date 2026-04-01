/*
  Warnings:

  - The values [DRAFT] on the enum `InvoiceStatus` will be removed. If these variants are still used in the database, this will fail.
  - The values [PARTIAL_PAYMENT_CONFIRMED,PARTIAL_INVOICE_GENERATED] on the enum `OrderStatus` will be removed. If these variants are still used in the database, this will fail.
  - A unique constraint covering the columns `[payment_ref]` on the table `Payment` will be added. If there are existing duplicate values, this will fail.

*/
-- AlterEnum
BEGIN;
CREATE TYPE "InvoiceStatus_new" AS ENUM ('ISSUED', 'PAID', 'OVERDUE', 'CANCELLED');
ALTER TABLE "public"."Invoice" ALTER COLUMN "status" DROP DEFAULT;
ALTER TABLE "Invoice" ALTER COLUMN "status" TYPE "InvoiceStatus_new" USING ("status"::text::"InvoiceStatus_new");
ALTER TYPE "InvoiceStatus" RENAME TO "InvoiceStatus_old";
ALTER TYPE "InvoiceStatus_new" RENAME TO "InvoiceStatus";
DROP TYPE "public"."InvoiceStatus_old";
ALTER TABLE "Invoice" ALTER COLUMN "status" SET DEFAULT 'ISSUED';
COMMIT;

-- AlterEnum
BEGIN;
CREATE TYPE "OrderStatus_new" AS ENUM ('PENDING', 'CONFIRMED', 'PAYMENT_PENDING', 'ADVANCE_RECEIVED', 'TOKEN_GENERATING', 'TOKEN_COMPLETE', 'TOKEN_GENERATED', 'DESIGN_GENERATING', 'DESIGN_COMPLETE', 'CARD_DESIGN', 'CARD_DESIGN_REVISION', 'CARD_DESIGN_READY', 'DESIGN_APPROVED', 'VENDOR_SENT', 'SENT_TO_VENDOR', 'PRINTING', 'PRINT_COMPLETE', 'SHIPPED', 'READY_TO_SHIP', 'OUT_FOR_DELIVERY', 'DELIVERED', 'BALANCE_PENDING', 'COMPLETED', 'CANCELLED', 'REFUNDED');
ALTER TABLE "public"."CardOrder" ALTER COLUMN "status" DROP DEFAULT;
ALTER TABLE "CardOrder" ALTER COLUMN "status" TYPE "OrderStatus_new" USING ("status"::text::"OrderStatus_new");
ALTER TABLE "OrderStatusLog" ALTER COLUMN "from_status" TYPE "OrderStatus_new" USING ("from_status"::text::"OrderStatus_new");
ALTER TABLE "OrderStatusLog" ALTER COLUMN "to_status" TYPE "OrderStatus_new" USING ("to_status"::text::"OrderStatus_new");
ALTER TYPE "OrderStatus" RENAME TO "OrderStatus_old";
ALTER TYPE "OrderStatus_new" RENAME TO "OrderStatus";
DROP TYPE "public"."OrderStatus_old";
ALTER TABLE "CardOrder" ALTER COLUMN "status" SET DEFAULT 'PENDING';
COMMIT;

-- AlterTable
ALTER TABLE "Notification" ADD COLUMN     "event_type" TEXT,
ADD COLUMN     "latency_ms" INTEGER,
ADD COLUMN     "order_id" TEXT,
ADD COLUMN     "provider_ref" TEXT;

-- AlterTable
ALTER TABLE "Payment" ADD COLUMN     "payment_ref" TEXT,
ALTER COLUMN "status" SET DEFAULT 'PENDING';

-- CreateIndex
CREATE INDEX "Notification_order_id_idx" ON "Notification"("order_id");

-- CreateIndex
CREATE INDEX "Notification_event_type_created_at_idx" ON "Notification"("event_type", "created_at");

-- CreateIndex
CREATE UNIQUE INDEX "Payment_payment_ref_key" ON "Payment"("payment_ref");

-- CreateIndex
CREATE INDEX "Payment_payment_ref_idx" ON "Payment"("payment_ref");
