/*
  Warnings:

  - You are about to drop the column `created_at` on the `ParentStudent` table. All the data in the column will be lost.

*/
-- AlterTable
ALTER TABLE "ParentStudent" DROP COLUMN "created_at",
ADD COLUMN     "linked_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP;

-- AlterTable
ALTER TABLE "ParentUser" ADD COLUMN     "active_student_id" TEXT;

-- AlterTable
ALTER TABLE "Student" ADD COLUMN     "claimed_at" TIMESTAMP(3);

-- CreateIndex
CREATE INDEX "ParentStudent_parent_id_idx" ON "ParentStudent"("parent_id");

-- AddForeignKey
ALTER TABLE "ParentUser" ADD CONSTRAINT "ParentUser_active_student_id_fkey" FOREIGN KEY ("active_student_id") REFERENCES "Student"("id") ON DELETE SET NULL ON UPDATE CASCADE;
