-- CreateEnum
CREATE TYPE "PipelineStepName" AS ENUM ('CREATE', 'CONFIRM', 'ADVANCE_INVOICE', 'ADVANCE_PAYMENT', 'TOKEN_GENERATION', 'CARD_DESIGN', 'VENDOR_DISPATCH', 'PRINTING_START', 'PRINTING_DONE', 'SHIPMENT_CREATE', 'SHIPMENT_SHIPPED', 'DELIVERY', 'BALANCE_INVOICE', 'BALANCE_PAYMENT', 'CANCEL', 'REFUND');

-- CreateEnum
CREATE TYPE "StepStatus" AS ENUM ('PENDING', 'RUNNING', 'COMPLETED', 'FAILED', 'PARTIAL_FAILED', 'SKIPPED');

-- CreateEnum
CREATE TYPE "JobStatus" AS ENUM ('QUEUED', 'RUNNING', 'COMPLETED', 'FAILED', 'RETRYING', 'DEAD');

-- CreateTable
CREATE TABLE "OrderPipeline" (
    "id" TEXT NOT NULL,
    "order_id" TEXT NOT NULL,
    "current_step" "PipelineStepName" NOT NULL,
    "overall_progress" INTEGER NOT NULL DEFAULT 0,
    "is_stalled" BOOLEAN NOT NULL DEFAULT false,
    "stalled_at" TIMESTAMP(3),
    "stalled_reason" TEXT,
    "started_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "completed_at" TIMESTAMP(3),
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "OrderPipeline_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "OrderStepExecution" (
    "id" TEXT NOT NULL,
    "pipeline_id" TEXT NOT NULL,
    "order_id" TEXT NOT NULL,
    "step" "PipelineStepName" NOT NULL,
    "attempt_number" INTEGER NOT NULL DEFAULT 1,
    "status" "StepStatus" NOT NULL DEFAULT 'PENDING',
    "started_at" TIMESTAMP(3),
    "completed_at" TIMESTAMP(3),
    "duration_ms" INTEGER,
    "progress" INTEGER NOT NULL DEFAULT 0,
    "progress_detail" JSONB,
    "result_summary" JSONB,
    "error_log" JSONB,
    "triggered_by" TEXT NOT NULL,
    "triggered_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "OrderStepExecution_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "JobExecution" (
    "id" TEXT NOT NULL,
    "step_execution_id" TEXT NOT NULL,
    "order_id" TEXT NOT NULL,
    "queue_name" TEXT NOT NULL,
    "bullmq_job_id" TEXT,
    "job_name" TEXT NOT NULL,
    "status" "JobStatus" NOT NULL DEFAULT 'QUEUED',
    "payload" JSONB NOT NULL,
    "queued_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "started_at" TIMESTAMP(3),
    "completed_at" TIMESTAMP(3),
    "duration_ms" INTEGER,
    "progress" INTEGER NOT NULL DEFAULT 0,
    "attempt_number" INTEGER NOT NULL DEFAULT 1,
    "max_attempts" INTEGER NOT NULL DEFAULT 3,
    "last_error" TEXT,
    "error_log" JSONB,
    "result" JSONB,

    CONSTRAINT "JobExecution_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "StepLog" (
    "id" TEXT NOT NULL,
    "step_execution_id" TEXT NOT NULL,
    "order_id" TEXT NOT NULL,
    "job_execution_id" TEXT,
    "level" TEXT NOT NULL,
    "message" TEXT NOT NULL,
    "context" JSONB,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "StepLog_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "OrderPipeline_order_id_key" ON "OrderPipeline"("order_id");

-- CreateIndex
CREATE INDEX "OrderPipeline_order_id_idx" ON "OrderPipeline"("order_id");

-- CreateIndex
CREATE INDEX "OrderPipeline_current_step_idx" ON "OrderPipeline"("current_step");

-- CreateIndex
CREATE INDEX "OrderPipeline_is_stalled_idx" ON "OrderPipeline"("is_stalled");

-- CreateIndex
CREATE INDEX "OrderStepExecution_pipeline_id_idx" ON "OrderStepExecution"("pipeline_id");

-- CreateIndex
CREATE INDEX "OrderStepExecution_order_id_idx" ON "OrderStepExecution"("order_id");

-- CreateIndex
CREATE INDEX "OrderStepExecution_step_status_idx" ON "OrderStepExecution"("step", "status");

-- CreateIndex
CREATE INDEX "OrderStepExecution_status_triggered_at_idx" ON "OrderStepExecution"("status", "triggered_at");

-- CreateIndex
CREATE UNIQUE INDEX "OrderStepExecution_pipeline_id_step_attempt_number_key" ON "OrderStepExecution"("pipeline_id", "step", "attempt_number");

-- CreateIndex
CREATE INDEX "JobExecution_step_execution_id_idx" ON "JobExecution"("step_execution_id");

-- CreateIndex
CREATE INDEX "JobExecution_order_id_idx" ON "JobExecution"("order_id");

-- CreateIndex
CREATE INDEX "JobExecution_queue_name_status_idx" ON "JobExecution"("queue_name", "status");

-- CreateIndex
CREATE INDEX "JobExecution_bullmq_job_id_idx" ON "JobExecution"("bullmq_job_id");

-- CreateIndex
CREATE INDEX "JobExecution_status_queued_at_idx" ON "JobExecution"("status", "queued_at");

-- CreateIndex
CREATE INDEX "StepLog_step_execution_id_idx" ON "StepLog"("step_execution_id");

-- CreateIndex
CREATE INDEX "StepLog_order_id_created_at_idx" ON "StepLog"("order_id", "created_at");

-- CreateIndex
CREATE INDEX "StepLog_level_created_at_idx" ON "StepLog"("level", "created_at");

-- AddForeignKey
ALTER TABLE "OrderPipeline" ADD CONSTRAINT "OrderPipeline_order_id_fkey" FOREIGN KEY ("order_id") REFERENCES "CardOrder"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "OrderStepExecution" ADD CONSTRAINT "OrderStepExecution_pipeline_id_fkey" FOREIGN KEY ("pipeline_id") REFERENCES "OrderPipeline"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "JobExecution" ADD CONSTRAINT "JobExecution_step_execution_id_fkey" FOREIGN KEY ("step_execution_id") REFERENCES "OrderStepExecution"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "StepLog" ADD CONSTRAINT "StepLog_step_execution_id_fkey" FOREIGN KEY ("step_execution_id") REFERENCES "OrderStepExecution"("id") ON DELETE CASCADE ON UPDATE CASCADE;
