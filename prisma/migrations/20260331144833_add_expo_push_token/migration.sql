/*
  Warnings:

  - You are about to drop the column `device_token` on the `ParentDevice` table. All the data in the column will be lost.
  - A unique constraint covering the columns `[expo_push_token]` on the table `ParentDevice` will be added. If there are existing duplicate values, this will fail.

*/
-- DropIndex
DROP INDEX "ParentDevice_device_token_key";

-- AlterTable
ALTER TABLE "ParentDevice" DROP COLUMN "device_token",
ADD COLUMN     "expo_push_token" TEXT;

-- CreateIndex
CREATE UNIQUE INDEX "ParentDevice_expo_push_token_key" ON "ParentDevice"("expo_push_token");