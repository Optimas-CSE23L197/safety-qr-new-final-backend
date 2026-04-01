/*
  Warnings:

  - The values [TOKEN_GENERATING,TOKEN_COMPLETE,DESIGN_GENERATING,DESIGN_COMPLETE,VENDOR_SENT] on the enum `OrderStatus` will be removed. If these variants are still used in the database, this will fail.

*/
-- AlterEnum
BEGIN;
CREATE TYPE "OrderStatus_new" AS ENUM ('PENDING', 'CONFIRMED', 'PAYMENT_PENDING', 'ADVANCE_RECEIVED', 'TOKEN_GENERATED', 'CARD_DESIGN', 'CARD_DESIGN_REVISION', 'CARD_DESIGN_READY', 'DESIGN_APPROVED', 'SENT_TO_VENDOR', 'PRINTING', 'PRINT_COMPLETE', 'SHIPPED', 'READY_TO_SHIP', 'OUT_FOR_DELIVERY', 'DELIVERED', 'BALANCE_PENDING', 'COMPLETED', 'CANCELLED', 'REFUNDED');
ALTER TABLE "public"."CardOrder" ALTER COLUMN "status" DROP DEFAULT;
ALTER TABLE "CardOrder" ALTER COLUMN "status" TYPE "OrderStatus_new" USING ("status"::text::"OrderStatus_new");
ALTER TABLE "OrderStatusLog" ALTER COLUMN "from_status" TYPE "OrderStatus_new" USING ("from_status"::text::"OrderStatus_new");
ALTER TABLE "OrderStatusLog" ALTER COLUMN "to_status" TYPE "OrderStatus_new" USING ("to_status"::text::"OrderStatus_new");
ALTER TYPE "OrderStatus" RENAME TO "OrderStatus_old";
ALTER TYPE "OrderStatus_new" RENAME TO "OrderStatus";
DROP TYPE "public"."OrderStatus_old";
ALTER TABLE "CardOrder" ALTER COLUMN "status" SET DEFAULT 'PENDING';
COMMIT;
