/*
  Warnings:

  - A unique constraint covering the columns `[serial_number]` on the table `School` will be added. If there are existing duplicate values, this will fail.

*/
-- AlterTable
ALTER TABLE "School" ADD COLUMN     "serial_number" SERIAL NOT NULL;

-- CreateIndex
CREATE UNIQUE INDEX "School_serial_number_key" ON "School"("serial_number");

-- CreateIndex
CREATE INDEX "School_serial_number_idx" ON "School"("serial_number");
