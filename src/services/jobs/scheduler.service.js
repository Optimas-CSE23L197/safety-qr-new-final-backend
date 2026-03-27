// =============================================================================
// job.scheduler.js — RESQID
// Centralized job scheduler for order orchestration tasks
// =============================================================================

import cron from 'node-cron';
import { logger } from '#config/logger.js';
import { prisma } from '#config/database/prisma.js';
import { redis } from '#config/database/redis.js';
import { notificationService } from '#services/communication/notification.service.js';

// =============================================================================
// CONFIGURATION
// =============================================================================

const JOB_CONFIG = {
  // Check stalled pipelines every 5 minutes
  STALLED_PIPELINE_CHECK: '*/5 * * * *',

  // Check DLQ every 10 minutes
  DLQ_CHECK: '*/10 * * * *',

  // Send overdue invoice reminders daily at 9 AM
  OVERDUE_INVOICE_REMINDER: '0 9 * * *',

  // Clean up old logs every Sunday at 2 AM
  LOG_CLEANUP: '0 2 * * 0',

  // Check pending payments daily at 10 AM
  PENDING_PAYMENT_CHECK: '0 10 * * *',

  // Clean up old Redis keys every day at 3 AM
  REDIS_CLEANUP: '0 3 * * *',
};

// =============================================================================
// JOB 1: Check Stalled Pipelines
// =============================================================================

async function checkStalledPipelines() {
  const startTime = Date.now();
  logger.info({ msg: 'Job started', job: 'stalled_pipeline_check' });

  try {
    const stalledPipelines = await prisma.orderPipeline.findMany({
      where: {
        is_stalled: true,
        completed_at: null,
        stalled_at: {
          not: null,
        },
      },
      include: {
        order: {
          select: {
            order_number: true,
            school_id: true,
          },
        },
      },
      take: 50,
    });

    logger.info({
      msg: 'Stalled pipelines found',
      count: stalledPipelines.length,
    });

    for (const pipeline of stalledPipelines) {
      try {
        const stalledDuration = Date.now() - new Date(pipeline.stalled_at).getTime();
        const stalledMinutes = Math.floor(stalledDuration / 60000);

        logger.warn({
          msg: 'Pipeline stalled',
          orderId: pipeline.order_id,
          orderNumber: pipeline.order?.order_number,
          currentStep: pipeline.current_step,
          stalledMinutes,
        });

        // Store metric in Redis
        const metricKey = `orch:stalled:${pipeline.order_id}`;
        await redis.hset(metricKey, {
          order_id: pipeline.order_id,
          current_step: pipeline.current_step,
          stalled_at: pipeline.stalled_at.toISOString(),
          stalled_reason: pipeline.stalled_reason,
          detected_at: new Date().toISOString(),
        });
        await redis.expire(metricKey, 86400 * 7); // 7 days

        // If stalled for more than 60 minutes, escalate
        if (stalledMinutes > 60) {
          const superAdmins = await prisma.superAdmin.findMany({
            where: { is_active: true },
            select: { id: true, email: true, name: true },
          });

          for (const admin of superAdmins) {
            await notificationService.send(
              'STALLED_PIPELINE_ESCALATED',
              {
                id: admin.id,
                email: admin.email,
                type: 'SUPER_ADMIN',
              },
              {
                orderId: pipeline.order_id,
                orderNumber: pipeline.order?.order_number,
                currentStep: pipeline.current_step,
                stalledMinutes,
                stalledReason: pipeline.stalled_reason,
              },
              ['email']
            );
          }
        }
      } catch (err) {
        logger.error({
          msg: 'Failed to process stalled pipeline',
          orderId: pipeline.order_id,
          error: err.message,
        });
      }
    }

    logger.info({
      msg: 'Job completed',
      job: 'stalled_pipeline_check',
      durationMs: Date.now() - startTime,
    });
  } catch (error) {
    logger.error({
      msg: 'Job failed',
      job: 'stalled_pipeline_check',
      error: error.message,
    });
  }
}

// =============================================================================
// JOB 2: Check Dead Letter Queue
// =============================================================================

async function checkDeadLetterQueue() {
  const startTime = Date.now();
  logger.info({ msg: 'Job started', job: 'dlq_check' });

  try {
    const dlqEntries = await prisma.deadLetterQueue.findMany({
      where: {
        resolved: false,
        last_attempt: {
          gte: new Date(Date.now() - 7 * 24 * 60 * 60 * 1000), // Last 7 days
        },
      },
      orderBy: { created_at: 'desc' },
      take: 100,
    });

    const unresolvedCount = dlqEntries.length;

    if (unresolvedCount > 0) {
      logger.warn({
        msg: 'Unresolved DLQ entries',
        count: unresolvedCount,
        oldest: dlqEntries[dlqEntries.length - 1]?.created_at,
      });

      // If more than 5 unresolved entries, alert super admins
      if (unresolvedCount > 5) {
        const superAdmins = await prisma.superAdmin.findMany({
          where: { is_active: true },
          select: { id: true, email: true, name: true },
        });

        const jobsByType = {};
        for (const entry of dlqEntries) {
          jobsByType[entry.job_type] = (jobsByType[entry.job_type] || 0) + 1;
        }

        for (const admin of superAdmins) {
          await notificationService.send(
            'DLQ_ALERT',
            {
              id: admin.id,
              email: admin.email,
              type: 'SUPER_ADMIN',
            },
            {
              totalUnresolved: unresolvedCount,
              jobsByType: JSON.stringify(jobsByType),
              oldestEntry: dlqEntries[dlqEntries.length - 1]?.created_at,
            },
            ['email']
          );
        }
      }
    }

    // Store DLQ metrics in Redis
    await redis.set('orch:dlq:unresolved_count', unresolvedCount);
    await redis.expire('orch:dlq:unresolved_count', 3600);

    logger.info({
      msg: 'Job completed',
      job: 'dlq_check',
      unresolvedCount,
      durationMs: Date.now() - startTime,
    });
  } catch (error) {
    logger.error({
      msg: 'Job failed',
      job: 'dlq_check',
      error: error.message,
    });
  }
}

// =============================================================================
// JOB 3: Send Overdue Invoice Reminders
// =============================================================================

async function sendOverdueInvoiceReminders() {
  const startTime = Date.now();
  logger.info({ msg: 'Job started', job: 'overdue_invoice_reminder' });

  try {
    const overdueInvoices = await prisma.invoice.findMany({
      where: {
        status: 'ISSUED',
        due_at: {
          lt: new Date(),
        },
      },
      include: {
        order: {
          include: {
            school: {
              select: {
                id: true,
                name: true,
                email: true,
                phone: true,
              },
            },
          },
        },
      },
      take: 100,
    });

    logger.info({
      msg: 'Overdue invoices found',
      count: overdueInvoices.length,
    });

    for (const invoice of overdueInvoices) {
      try {
        const daysOverdue = Math.floor(
          (Date.now() - new Date(invoice.due_at).getTime()) / (1000 * 60 * 60 * 24)
        );

        // Only send reminder if not already sent today
        const lastReminderKey = `invoice:reminder:${invoice.id}`;
        const lastSent = await redis.get(lastReminderKey);

        if (!lastSent || daysOverdue % 3 === 0) {
          await notificationService.notifyOrder(
            'INVOICE_OVERDUE',
            invoice.order,
            invoice.order.school,
            {
              invoiceNumber: invoice.invoice_number,
              amount: invoice.total_amount / 100,
              dueDate: invoice.due_at,
              daysOverdue,
            }
          );

          await redis.set(lastReminderKey, Date.now(), 'EX', 86400); // 1 day TTL
          logger.info({
            msg: 'Overdue invoice reminder sent',
            invoiceId: invoice.id,
            daysOverdue,
          });
        }
      } catch (err) {
        logger.error({
          msg: 'Failed to send overdue reminder',
          invoiceId: invoice.id,
          error: err.message,
        });
      }
    }

    logger.info({
      msg: 'Job completed',
      job: 'overdue_invoice_reminder',
      processed: overdueInvoices.length,
      durationMs: Date.now() - startTime,
    });
  } catch (error) {
    logger.error({
      msg: 'Job failed',
      job: 'overdue_invoice_reminder',
      error: error.message,
    });
  }
}

// =============================================================================
// JOB 4: Clean Up Old Logs
// =============================================================================

async function cleanupOldLogs() {
  const startTime = Date.now();
  logger.info({ msg: 'Job started', job: 'log_cleanup' });

  try {
    const thirtyDaysAgo = new Date();
    thirtyDaysAgo.setDate(thirtyDaysAgo.getDate() - 30);

    // Clean up old StepLogs
    const deletedStepLogs = await prisma.stepLog.deleteMany({
      where: {
        created_at: {
          lt: thirtyDaysAgo,
        },
      },
    });

    // Clean up old OrderStatusLogs
    const deletedStatusLogs = await prisma.orderStatusLog.deleteMany({
      where: {
        created_at: {
          lt: thirtyDaysAgo,
        },
      },
    });

    // Clean up old AuditLogs
    const deletedAuditLogs = await prisma.auditLog.deleteMany({
      where: {
        created_at: {
          lt: thirtyDaysAgo,
        },
      },
    });

    logger.info({
      msg: 'Job completed',
      job: 'log_cleanup',
      deletedStepLogs: deletedStepLogs.count,
      deletedStatusLogs: deletedStatusLogs.count,
      deletedAuditLogs: deletedAuditLogs.count,
      durationMs: Date.now() - startTime,
    });
  } catch (error) {
    logger.error({
      msg: 'Job failed',
      job: 'log_cleanup',
      error: error.message,
    });
  }
}

// =============================================================================
// JOB 5: Check Pending Payments
// =============================================================================

async function checkPendingPayments() {
  const startTime = Date.now();
  logger.info({ msg: 'Job started', job: 'pending_payment_check' });

  try {
    const pendingOrders = await prisma.cardOrder.findMany({
      where: {
        payment_status: 'PARTIALLY_PAID',
        status: 'BALANCE_PENDING',
        balance_due_at: {
          lt: new Date(),
        },
      },
      include: {
        school: {
          select: {
            id: true,
            name: true,
            email: true,
            phone: true,
          },
        },
        balanceInvoice: true,
      },
      take: 50,
    });

    logger.info({
      msg: 'Pending payments found',
      count: pendingOrders.length,
    });

    for (const order of pendingOrders) {
      try {
        const daysOverdue = Math.floor(
          (Date.now() - new Date(order.balance_due_at).getTime()) / (1000 * 60 * 60 * 24)
        );

        // Send reminder only for overdue payments
        if (daysOverdue >= 0) {
          await notificationService.notifyOrder('PAYMENT_OVERDUE', order, order.school, {
            amount: order.balance_amount / 100,
            dueDate: order.balance_due_at,
            daysOverdue,
            invoiceNumber: order.balanceInvoice?.invoice_number,
          });

          logger.info({
            msg: 'Payment overdue reminder sent',
            orderId: order.id,
            daysOverdue,
          });
        }
      } catch (err) {
        logger.error({
          msg: 'Failed to send payment reminder',
          orderId: order.id,
          error: err.message,
        });
      }
    }

    logger.info({
      msg: 'Job completed',
      job: 'pending_payment_check',
      processed: pendingOrders.length,
      durationMs: Date.now() - startTime,
    });
  } catch (error) {
    logger.error({
      msg: 'Job failed',
      job: 'pending_payment_check',
      error: error.message,
    });
  }
}

// =============================================================================
// JOB 6: Clean Up Old Redis Keys
// =============================================================================

async function cleanupOldRedisKeys() {
  const startTime = Date.now();
  logger.info({ msg: 'Job started', job: 'redis_cleanup' });

  try {
    // Clean up expired idempotency keys (they have TTL, but just in case)
    const idempotencyKeys = await redis.keys('orch:idem:*');
    let deletedCount = 0;

    for (const key of idempotencyKeys) {
      const ttl = await redis.ttl(key);
      if (ttl === -2) {
        // Key doesn't exist
        continue;
      }
      if (ttl === -1) {
        // No expiry, delete it
        await redis.del(key);
        deletedCount++;
      }
    }

    logger.info({
      msg: 'Job completed',
      job: 'redis_cleanup',
      deletedKeys: deletedCount,
      durationMs: Date.now() - startTime,
    });
  } catch (error) {
    logger.error({
      msg: 'Job failed',
      job: 'redis_cleanup',
      error: error.message,
    });
  }
}

// =============================================================================
// JOB 7: Generate Daily Metrics Report
// =============================================================================

async function generateDailyMetrics() {
  const startTime = Date.now();
  logger.info({ msg: 'Job started', job: 'daily_metrics' });

  try {
    const today = new Date();
    today.setHours(0, 0, 0, 0);

    const yesterday = new Date(today);
    yesterday.setDate(yesterday.getDate() - 1);

    // Get order counts
    const [totalOrders, completedOrders, cancelledOrders, stalledOrders] = await Promise.all([
      prisma.cardOrder.count(),
      prisma.cardOrder.count({ where: { status: 'COMPLETED' } }),
      prisma.cardOrder.count({ where: { status: 'CANCELLED' } }),
      prisma.orderPipeline.count({ where: { is_stalled: true } }),
    ]);

    // Get payment totals
    const payments = await prisma.payment.aggregate({
      where: {
        created_at: {
          gte: yesterday,
          lt: today,
        },
        status: 'SUCCESS',
      },
      _sum: {
        amount: true,
      },
    });

    // Get queue health
    const queueHealth = await getQueueHealthFromRedis();

    const metrics = {
      date: today.toISOString().split('T')[0],
      orders: {
        total: totalOrders,
        completed: completedOrders,
        cancelled: cancelledOrders,
        stalled: stalledOrders,
        completionRate: totalOrders > 0 ? ((completedOrders / totalOrders) * 100).toFixed(2) : 0,
      },
      payments: {
        yesterdayTotal: (payments._sum.amount || 0) / 100,
      },
      queueHealth,
    };

    // Store metrics in Redis
    await redis.set(`metrics:daily:${today.toISOString().split('T')[0]}`, JSON.stringify(metrics));
    await redis.expire(`metrics:daily:${today.toISOString().split('T')[0]}`, 86400 * 30);

    // Send metrics to super admins if any anomalies
    if (stalledOrders > 10) {
      const superAdmins = await prisma.superAdmin.findMany({
        where: { is_active: true },
        select: { id: true, email: true },
      });

      for (const admin of superAdmins) {
        await notificationService.send(
          'DAILY_METRICS_ALERT',
          {
            id: admin.id,
            email: admin.email,
            type: 'SUPER_ADMIN',
          },
          {
            stalledOrders,
            completionRate: metrics.orders.completionRate,
          },
          ['email']
        );
      }
    }

    logger.info({
      msg: 'Job completed',
      job: 'daily_metrics',
      metrics,
      durationMs: Date.now() - startTime,
    });
  } catch (error) {
    logger.error({
      msg: 'Job failed',
      job: 'daily_metrics',
      error: error.message,
    });
  }
}

// Helper to get queue health
async function getQueueHealthFromRedis() {
  try {
    const queueKeys = await redis.keys('bull:*:id');
    return {
      queueCount: queueKeys.length,
      status: 'ok',
    };
  } catch {
    return { status: 'error' };
  }
}

// =============================================================================
// SCHEDULER MANAGER
// =============================================================================

let scheduledJobs = [];

export const jobScheduler = {
  start: () => {
    logger.info({ msg: 'Starting job scheduler' });

    // Schedule all jobs
    scheduledJobs = [
      cron.schedule(JOB_CONFIG.STALLED_PIPELINE_CHECK, checkStalledPipelines),
      cron.schedule(JOB_CONFIG.DLQ_CHECK, checkDeadLetterQueue),
      cron.schedule(JOB_CONFIG.OVERDUE_INVOICE_REMINDER, sendOverdueInvoiceReminders),
      cron.schedule(JOB_CONFIG.LOG_CLEANUP, cleanupOldLogs),
      cron.schedule(JOB_CONFIG.PENDING_PAYMENT_CHECK, checkPendingPayments),
      cron.schedule(JOB_CONFIG.REDIS_CLEANUP, cleanupOldRedisKeys),
    ];

    // Run daily metrics at 8 AM
    scheduledJobs.push(cron.schedule('0 8 * * *', generateDailyMetrics));

    // Run initial checks after startup (5 seconds delay)
    setTimeout(() => {
      checkStalledPipelines();
      checkDeadLetterQueue();
    }, 5000);

    logger.info({
      msg: 'Job scheduler started',
      jobs: [
        'stalled_pipeline_check',
        'dlq_check',
        'overdue_invoice_reminder',
        'log_cleanup',
        'pending_payment_check',
        'redis_cleanup',
        'daily_metrics',
      ],
    });

    return scheduledJobs;
  },

  stop: async () => {
    logger.info({ msg: 'Stopping job scheduler' });

    for (const job of scheduledJobs) {
      job.stop();
    }

    scheduledJobs = [];
    logger.info({ msg: 'Job scheduler stopped' });
  },

  // Manual trigger for testing
  trigger: async jobName => {
    switch (jobName) {
      case 'stalled_pipeline_check':
        await checkStalledPipelines();
        break;
      case 'dlq_check':
        await checkDeadLetterQueue();
        break;
      case 'overdue_invoice_reminder':
        await sendOverdueInvoiceReminders();
        break;
      case 'log_cleanup':
        await cleanupOldLogs();
        break;
      case 'pending_payment_check':
        await checkPendingPayments();
        break;
      case 'redis_cleanup':
        await cleanupOldRedisKeys();
        break;
      case 'daily_metrics':
        await generateDailyMetrics();
        break;
      default:
        throw new Error(`Unknown job: ${jobName}`);
    }
  },
};

export default jobScheduler;
