/*
  Warnings:

  - A unique constraint covering the columns `[device_fingerprint]` on the table `ParentDevice` will be added. If there are existing duplicate values, this will fail.

*/
-- AlterTable
ALTER TABLE "ParentDevice" ADD COLUMN     "device_fingerprint" TEXT;

-- CreateIndex
CREATE UNIQUE INDEX "ParentDevice_device_fingerprint_key" ON "ParentDevice"("device_fingerprint");
