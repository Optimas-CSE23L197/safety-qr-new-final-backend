// =============================================================================
// orchestrator/dlq/dlq.handler.js — RESQID PHASE 1
// Dead Letter Queue handler.
// =============================================================================

import { prisma } from '#config/prisma.js';
import { logger } from '#config/logger.js';
import { redis } from '#config/redis.js';
import { QUEUE_NAMES } from '../queues/queue.names.js';

const DLQ_BATCH_KEY = 'orch:dlq:pending_slack_batch';
const DLQ_BATCH_TTL = 3600; // flush every hour

const SLACK_WEBHOOK_URL = process.env.SLACK_ALERTS_WEBHOOK;

async function sendSlackMessage(message) {
  if (!SLACK_WEBHOOK_URL) {
    logger.warn('[dlq.handler] Slack webhook not configured, skipping notification');
    return;
  }

  try {
    const response = await fetch(SLACK_WEBHOOK_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(message),
    });
    if (!response.ok) {
      logger.warn({ status: response.status }, '[dlq.handler] Slack send failed');
    }
  } catch (err) {
    logger.error({ err: err.message }, '[dlq.handler] Slack send error');
  }
}

export const handleDeadJob = async ({ job, error, queueName }) => {
  const isEmergency = queueName === QUEUE_NAMES.EMERGENCY_ALERTS;

  const entry = {
    job_type: job.name,
    queue_name: queueName,
    bullmq_job_id: String(job.id),
    payload: job.data ?? {},
    error_message: error?.message ?? 'Unknown error',
    error_stack: error?.stack ?? null,
    retry_count: job.attemptsMade ?? 0,
    resolved: false,
  };

  let dbRecord = null;
  try {
    dbRecord = await prisma.deadLetterQueue.create({ data: entry });
    logger.error(
      { dlqId: dbRecord.id, jobType: job.name, queueName, retries: entry.retry_count },
      '[dlq.handler] Job moved to DLQ'
    );
  } catch (dbErr) {
    logger.error(
      { err: dbErr.message, jobType: job.name, queueName },
      '[dlq.handler] Failed to write DLQ entry to DB'
    );
  }

  if (isEmergency) {
    await sendSlackMessage({
      text:
        `🚨 *CRITICAL: Emergency Alert Failed* 🚨\n\n` +
        `*Job Type:* ${job.name}\n` +
        `*Job ID:* ${job.id}\n` +
        `*Error:* ${error?.message ?? 'Unknown'}\n` +
        `*Retries:* ${entry.retry_count}\n` +
        `*DLQ ID:* ${dbRecord?.id ?? 'DB write failed'}\n` +
        `*Time:* ${new Date().toISOString()}`,
      mrkdwn: true,
    });
  } else {
    try {
      await redis.sadd(
        DLQ_BATCH_KEY,
        JSON.stringify({
          jobType: job.name,
          queueName,
          jobId: String(job.id),
          error: error?.message ?? 'Unknown',
          dlqId: dbRecord?.id ?? null,
          timestamp: new Date().toISOString(),
        })
      );
      await redis.expire(DLQ_BATCH_KEY, DLQ_BATCH_TTL);
    } catch (redisErr) {
      logger.error({ err: redisErr.message }, '[dlq.handler] Failed to add to Slack batch');
    }
  }
};

export async function flushDlqSlackBatch() {
  try {
    const entries = await redis.smembers(DLQ_BATCH_KEY);
    if (!entries || entries.length === 0) {
      return;
    }

    const messages = entries.map(e => JSON.parse(e));
    const text =
      `⚠️ *DLQ Batch Flush* ⚠️\n\n` +
      messages
        .map(
          m =>
            `• Job: ${m.jobType} (Queue: ${m.queueName}, ID: ${m.jobId})\n  Error: ${m.error}\n  DLQ ID: ${m.dlqId ?? 'N/A'}\n  Time: ${m.timestamp}`
        )
        .join('\n\n');

    await sendSlackMessage({ text, mrkdwn: true });

    // Clear batch after sending
    await redis.del(DLQ_BATCH_KEY);
    logger.info('[dlq.handler] DLQ batch flushed to Slack');
  } catch (err) {
    logger.error({ err: err.message }, '[dlq.handler] Failed to flush DLQ batch');
  }
}
