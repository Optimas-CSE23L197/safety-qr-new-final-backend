// =============================================================================
// orchestrator/jobs/dlqMonitor.job.js — RESQID PHASE 1
// DLQ Monitor — checks DeadLetterQueue table, not a BullMQ queue
// =============================================================================

import { prisma } from '#config/prisma.js';
import { logger } from '#config/logger.js';

/**
 * Main DLQ monitor job execution
 * @returns {Promise<{ success: boolean, dlqCount: number, notificationSent: boolean }>}
 */
export const executeDlqMonitor = async () => {
  const startTime = Date.now();
  logger.info('[dlqMonitor] Job started');

  try {
    const unresolvedCount = await prisma.deadLetterQueue.count({
      where: { resolved: false },
    });

    const recentUnresolved = await prisma.deadLetterQueue.findMany({
      where: { resolved: false },
      orderBy: { created_at: 'desc' },
      take: 10,
      select: {
        id: true,
        job_type: true,
        queue_name: true,
        error_message: true,
        created_at: true,
        retry_count: true,
      },
    });

    logger.info(
      { unresolvedCount, recentCount: recentUnresolved.length },
      '[dlqMonitor] DLQ stats'
    );

    let notificationSent = false;
    if (unresolvedCount > 0) {
      await notifySuperAdmins(unresolvedCount, recentUnresolved);
      notificationSent = true;
    }

    const duration = Date.now() - startTime;
    logger.info({ duration, unresolvedCount, notificationSent }, '[dlqMonitor] Job completed');

    return {
      success: true,
      dlqCount: unresolvedCount,
      notificationSent,
      duration,
    };
  } catch (error) {
    logger.error({ error: error.message }, '[dlqMonitor] Job failed');
    throw error;
  }
};

const notifySuperAdmins = async (count, jobs) => {
  try {
    const superAdmins = await prisma.superAdmin.findMany({
      where: { is_active: true },
      select: { id: true },
    });

    if (superAdmins.length === 0) return;

    // Check for ANY unread DLQ notification in last 15 minutes — avoid spam
    const existingNotification = await prisma.dashboardNotification.findFirst({
      where: {
        type: 'DLQ_NEW_ENTRY',
        read: false,
        created_at: { gte: new Date(Date.now() - 15 * 60 * 1000) },
      },
    });

    if (existingNotification) {
      logger.debug('[dlqMonitor] Skipping notification — unread DLQ alert already exists');
      return;
    }

    const notifications = superAdmins.map(admin => ({
      user_id: admin.id,
      user_type: 'SUPER_ADMIN',
      type: 'DLQ_NEW_ENTRY',
      title: `⚠️ DLQ Alert: ${count} Failed Job${count > 1 ? 's' : ''}`,
      body: `${count} job${count > 1 ? 's have' : ' has'} failed. Review in Dead Letter Queue.`,
      metadata: {
        dlqCount: count,
        jobs: jobs.map(j => ({
          id: j.id,
          jobType: j.job_type,
          queue: j.queue_name,
          error: j.error_message?.substring(0, 200),
        })),
      },
      created_at: new Date(),
    }));

    await prisma.dashboardNotification.createMany({ data: notifications });
    logger.info({ count, superAdmins: superAdmins.length }, '[dlqMonitor] Notifications sent');
  } catch (error) {
    logger.error({ error: error.message }, '[dlqMonitor] Failed to create notifications');
  }
};

export const createDlqMonitorHandler = () => {
  return async () => executeDlqMonitor();
};

export default { executeDlqMonitor, createDlqMonitorHandler };
