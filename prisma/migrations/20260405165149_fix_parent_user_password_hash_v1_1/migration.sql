/*
  Warnings:

  - You are about to drop the column `password_hash` on the `ParentUser` table. All the data in the column will be lost.

*/
-- AlterTable
ALTER TABLE "ParentUser" DROP COLUMN "password_hash";
