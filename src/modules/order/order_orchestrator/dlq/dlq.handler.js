// =============================================================================
// dlq/dlq.handler.js
// Complete DLQ handler with processing, retry, and cleanup.
// =============================================================================

import { Worker } from 'bullmq';
import { redis } from '#config/database/redis.js';
import { logger } from '#config/logger.js';
import { prisma } from '#config/database/prisma.js';
import { QUEUE_NAMES, JOB_NAMES, REDIS_KEYS } from './orchestrator.constants.js';
import { getQueue } from './queues/queue.manager.js';
import { publishNotification } from './events/event.publisher.js';
import { NOTIFICATION_EVENTS } from './notifications/notification.events.js';

/**
 * Record DLQ entry in database
 */
async function recordDlqEntry(jobData, error, orderId = null) {
  try {
    return await prisma.deadLetterQueue.create({
      data: {
        job_type: jobData.originalJobName || 'unknown',
        order_id: orderId || jobData.originalData?.orderId || jobData.orderId,
        school_id: jobData.originalData?.schoolId || jobData.schoolId,
        payload: jobData,
        error_message: error?.message || String(error),
        retry_count: jobData.attemptsMade || 0,
        last_attempt: new Date(),
      },
    });
  } catch (dbError) {
    logger.error({
      msg: 'Failed to record DLQ entry in database',
      error: dbError.message,
      jobData,
    });
    return null;
  }
}

/**
 * Notify super admins about DLQ entry
 */
async function notifySuperAdmins(jobData, error, dlqId, orderId) {
  try {
    const superAdmins = await prisma.superAdmin.findMany({
      where: { is_active: true },
      select: { id: true, email: true, name: true },
    });

    for (const admin of superAdmins) {
      await publishNotification(
        NOTIFICATION_EVENTS.DLQ_ALERT,
        orderId,
        admin.id,
        'SUPER_ADMIN',
        {
          jobType: jobData.originalJobName,
          orderId: orderId || 'N/A',
          error: error?.message || String(error),
          dlqId,
          timestamp: new Date().toISOString(),
          schoolId: jobData.originalData?.schoolId || jobData.schoolId,
          attemptsMade: jobData.attemptsMade,
        },
        `dlq:${dlqId}:${admin.id}`
      );
    }

    logger.info({
      msg: 'DLQ alert sent to super admins',
      dlqId,
      orderId,
      adminCount: superAdmins.length,
    });
  } catch (notifyError) {
    logger.error({
      msg: 'Failed to notify super admins',
      error: notifyError.message,
      dlqId,
    });
  }
}

/**
 * Update pipeline status for failed order
 */
async function updatePipelineStatus(orderId, error, jobData) {
  if (!orderId) return;

  try {
    const pipeline = await prisma.orderPipeline.findFirst({
      where: { order_id: orderId },
    });

    if (pipeline && !pipeline.is_stalled) {
      await prisma.orderPipeline.update({
        where: { id: pipeline.id },
        data: {
          is_stalled: true,
          stalled_at: new Date(),
          stalled_reason: `Job ${jobData.originalJobName} failed: ${error.message}`,
        },
      });
    }

    // Increment failure count in Redis
    const failureKey = REDIS_KEYS.DLQ_COUNT(orderId);
    await redis.incr(failureKey);
    await redis.expire(failureKey, 86400 * 7); // 7 days
  } catch (updateError) {
    logger.error({
      msg: 'Failed to update pipeline status',
      error: updateError.message,
      orderId,
    });
  }
}

/**
 * Process a single DLQ job
 */
async function processDlqJob(job) {
  const jobData = job.data;
  const error = {
    message: jobData.error?.message || jobData.error,
    stack: jobData.error?.stack,
  };
  const orderId = jobData.originalData?.orderId || jobData.orderId;

  logger.error({
    msg: 'Processing DLQ job',
    dlqJobId: job.id,
    originalJobName: jobData.originalJobName,
    orderId,
    error: error.message,
    attemptsMade: jobData.attemptsMade,
  });

  // Record in database
  const dlqRecord = await recordDlqEntry(jobData, error, orderId);

  // Update pipeline status
  await updatePipelineStatus(orderId, error, jobData);

  // Notify super admins
  if (dlqRecord) {
    await notifySuperAdmins(jobData, error, dlqRecord.id, orderId);
  }

  // Increment DLQ counter for monitoring
  await redis.incr('orch:dlq:total');
  await redis.expire('orch:dlq:total', 86400 * 30);

  return {
    processed: true,
    dlqId: dlqRecord?.id,
    jobType: jobData.originalJobName,
    orderId,
    timestamp: new Date().toISOString(),
  };
}

/**
 * Create DLQ worker
 */
export function createDlqWorker() {
  const worker = new Worker(
    QUEUE_NAMES.DLQ,
    async job => {
      logger.info({
        msg: 'DLQ worker processing job',
        jobId: job.id,
        originalJobName: job.data?.originalJobName,
        orderId: job.data?.originalData?.orderId || job.data?.orderId,
      });

      try {
        const result = await processDlqJob(job);

        logger.info({
          msg: 'DLQ worker completed',
          jobId: job.id,
          dlqId: result.dlqId,
        });

        return result;
      } catch (error) {
        logger.error({
          msg: 'DLQ worker failed to process',
          jobId: job.id,
          error: error.message,
          stack: error.stack,
        });

        // Re-throw to let BullMQ handle retry
        throw error;
      }
    },
    {
      connection: { client: redis },
      concurrency: 2,
      autorun: false,
      settings: {
        stalledInterval: 30000,
        maxStalledCount: 3,
        lockDuration: 60000,
      },
    }
  );

  worker.on('completed', job => {
    logger.info({
      msg: 'DLQ worker job completed',
      jobId: job.id,
      result: job.returnvalue,
    });
  });

  worker.on('failed', (job, err) => {
    logger.error({
      msg: 'DLQ worker job failed',
      jobId: job?.id,
      error: err.message,
      stack: err.stack,
    });
  });

  worker.on('error', err => {
    logger.error({
      msg: 'DLQ worker error',
      error: err.message,
    });
  });

  logger.info({ msg: 'DLQ worker created' });

  return worker;
}

/**
 * DLQ Service for manual operations
 */
export const DlqService = {
  /**
   * List all unresolved DLQ entries
   */
  async listUnresolved(limit = 100, offset = 0, filters = {}) {
    const where = { resolved: false };

    if (filters.jobType) {
      where.job_type = filters.jobType;
    }

    if (filters.orderId) {
      where.order_id = filters.orderId;
    }

    const [entries, total] = await Promise.all([
      prisma.deadLetterQueue.findMany({
        where,
        orderBy: { created_at: 'desc' },
        take: limit,
        skip: offset,
      }),
      prisma.deadLetterQueue.count({ where }),
    ]);

    return { entries, total };
  },

  /**
   * Get DLQ entry by ID
   */
  async getById(dlqId) {
    return prisma.deadLetterQueue.findUnique({
      where: { id: dlqId },
    });
  },

  /**
   * Resolve a DLQ entry after manual fix
   */
  async resolve(dlqId, resolvedBy, notes = '') {
    const dlqEntry = await prisma.deadLetterQueue.findUnique({
      where: { id: dlqId },
    });

    if (!dlqEntry) {
      throw new Error(`DLQ entry ${dlqId} not found`);
    }

    const updated = await prisma.deadLetterQueue.update({
      where: { id: dlqId },
      data: {
        resolved: true,
        resolved_at: new Date(),
      },
    });

    // Log resolution
    await prisma.auditLog.create({
      data: {
        actor_id: resolvedBy,
        actor_type: 'SUPER_ADMIN',
        action: 'DLQ_RESOLVED',
        entity: 'DeadLetterQueue',
        entity_id: dlqId,
        new_value: { notes, resolvedAt: new Date() },
      },
    });

    return updated;
  },

  /**
   * Reprocess a DLQ entry (re-add to original queue)
   */
  async reprocess(dlqId, options = {}) {
    const dlqEntry = await prisma.deadLetterQueue.findUnique({
      where: { id: dlqId },
    });

    if (!dlqEntry) {
      throw new Error(`DLQ entry ${dlqId} not found`);
    }

    const payload = dlqEntry.payload;
    const originalQueueName = payload.originalQueue;
    const originalJobName = payload.originalJobName;
    const originalData = payload.originalData;

    if (!originalQueueName || !originalJobName) {
      throw new Error(`Cannot reprocess: missing queue or job name`);
    }

    const queue = getQueue(originalQueueName);

    const newJob = await queue.add(originalJobName, originalData, {
      jobId: `${originalJobName}:reprocess:${dlqId}:${Date.now()}`,
      attempts: options.attempts || 3,
      backoff: {
        type: 'exponential',
        delay: options.delay || 2000,
      },
      ...options,
    });

    // Update DLQ entry with reprocess info
    await prisma.deadLetterQueue.update({
      where: { id: dlqId },
      data: {
        metadata: {
          reprocessedAt: new Date().toISOString(),
          reprocessedBy: options.processedBy,
          newJobId: newJob.id,
        },
      },
    });

    logger.info({
      msg: 'DLQ entry reprocessed',
      dlqId,
      newJobId: newJob.id,
      queue: originalQueueName,
    });

    return { reprocessed: true, dlqId, newJobId: newJob.id };
  },

  /**
   * Bulk reprocess multiple DLQ entries
   */
  async bulkReprocess(dlqIds, options = {}) {
    const results = [];

    for (const dlqId of dlqIds) {
      try {
        const result = await this.reprocess(dlqId, options);
        results.push({ dlqId, success: true, ...result });
      } catch (error) {
        results.push({ dlqId, success: false, error: error.message });
      }
    }

    return results;
  },

  /**
   * Get DLQ statistics
   */
  async getStats() {
    const [total, resolved, unresolved, byJobType] = await Promise.all([
      prisma.deadLetterQueue.count(),
      prisma.deadLetterQueue.count({ where: { resolved: true } }),
      prisma.deadLetterQueue.count({ where: { resolved: false } }),
      prisma.deadLetterQueue.groupBy({
        by: ['job_type'],
        _count: true,
        where: { resolved: false },
      }),
    ]);

    // Get Redis counters
    const totalRedis = await redis.get('orch:dlq:total');
    const orderCounts = await redis.keys(REDIS_KEYS.DLQ_COUNT('*'));

    const orderFailureStats = {};
    for (const key of orderCounts.slice(0, 50)) {
      const orderId = key.replace('orch:dlq:count:', '');
      const count = await redis.get(key);
      orderFailureStats[orderId] = parseInt(count, 10);
    }

    return {
      total,
      resolved,
      unresolved: unresolved,
      resolutionRate: total > 0 ? ((resolved / total) * 100).toFixed(2) : 0,
      byJobType: byJobType.map(item => ({
        jobType: item.job_type,
        count: item._count,
      })),
      redis: {
        totalJobs: parseInt(totalRedis || '0', 10),
        topFailingOrders: Object.entries(orderFailureStats)
          .sort((a, b) => b[1] - a[1])
          .slice(0, 10),
      },
    };
  },

  /**
   * Clean old resolved DLQ entries
   */
  async cleanOldEntries(daysOld = 30) {
    const cutoffDate = new Date();
    cutoffDate.setDate(cutoffDate.getDate() - daysOld);

    const deleted = await prisma.deadLetterQueue.deleteMany({
      where: {
        resolved: true,
        resolved_at: { lt: cutoffDate },
      },
    });

    logger.info({
      msg: 'Cleaned old DLQ entries',
      deleted: deleted.count,
      daysOld,
    });

    return deleted.count;
  },

  /**
   * Get DLQ entry with full details
   */
  async getDetails(dlqId) {
    const entry = await prisma.deadLetterQueue.findUnique({
      where: { id: dlqId },
    });

    if (!entry) return null;

    // Try to get related order details
    let orderDetails = null;
    if (entry.order_id) {
      orderDetails = await prisma.cardOrder.findUnique({
        where: { id: entry.order_id },
        select: {
          id: true,
          order_number: true,
          status: true,
          school_id: true,
          school: {
            select: { name: true, email: true, phone: true },
          },
        },
      });
    }

    return {
      ...entry,
      orderDetails,
    };
  },
};
