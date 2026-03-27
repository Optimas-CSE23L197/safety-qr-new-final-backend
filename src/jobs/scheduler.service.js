// =============================================================================
// job.scheduler.js — RESQID
// Centralized job scheduler for order orchestration tasks
// =============================================================================

import cron from 'node-cron';
import { logger } from '#config/logger.js';
import { prisma } from '#config/prisma.js';
import { redis } from '#config/redis.js';

// Import the CORRECT notification service from shared
import {
  sendEmailNotification,
  sendSmsNotification,
  notifyParent,
} from '#services/notification.service.js';

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

  // Generate daily metrics at 8 AM
  DAILY_METRICS: '0 8 * * *',
};

// =============================================================================
// JOB 1: Check Stalled Pipelines
// =============================================================================

async function checkStalledPipelines() {
  const startTime = Date.now();
  logger.info({ job: 'stalled_pipeline_check' }, 'Job started');

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
            school: {
              select: {
                name: true,
                email: true,
                phone: true,
              },
            },
          },
        },
      },
      take: 50,
    });

    logger.info(
      {
        job: 'stalled_pipeline_check',
        count: stalledPipelines.length,
      },
      'Stalled pipelines found'
    );

    for (const pipeline of stalledPipelines) {
      try {
        const stalledDuration = Date.now() - new Date(pipeline.stalled_at).getTime();
        const stalledMinutes = Math.floor(stalledDuration / 60000);

        logger.warn(
          {
            job: 'stalled_pipeline_check',
            orderId: pipeline.order_id,
            orderNumber: pipeline.order?.order_number,
            currentStep: pipeline.current_step,
            stalledMinutes,
            stalledReason: pipeline.stalled_reason,
          },
          'Pipeline stalled'
        );

        // Store metric in Redis
        const metricKey = `orch:stalled:${pipeline.order_id}`;
        await redis.hset(metricKey, {
          order_id: pipeline.order_id,
          order_number: pipeline.order?.order_number,
          current_step: pipeline.current_step,
          stalled_at: pipeline.stalled_at.toISOString(),
          stalled_reason: pipeline.stalled_reason,
          detected_at: new Date().toISOString(),
        });
        await redis.expire(metricKey, 86400 * 7); // 7 days

        // If stalled for more than 60 minutes, escalate to super admins
        if (stalledMinutes > 60) {
          const superAdmins = await prisma.superAdmin.findMany({
            where: { is_active: true },
            select: { id: true, email: true, name: true },
          });

          const emailHtml = `
            <div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto;">
              <h1 style="color: #ff4444;">🚨 Stalled Pipeline Alert</h1>
              <p><strong>Order ID:</strong> ${pipeline.order_id}</p>
              <p><strong>Order Number:</strong> ${pipeline.order?.order_number}</p>
              <p><strong>School:</strong> ${pipeline.order?.school?.name || 'N/A'}</p>
              <p><strong>Current Step:</strong> ${pipeline.current_step}</p>
              <p><strong>Stalled Duration:</strong> ${stalledMinutes} minutes</p>
              <p><strong>Stalled Reason:</strong> ${pipeline.stalled_reason || 'Unknown'}</p>
              <p><strong>Detected At:</strong> ${new Date().toISOString()}</p>
              <p>Please investigate this issue immediately.</p>
              <hr />
              <p style="color: #666; font-size: 12px;">RESQID System Monitor</p>
            </div>
          `;

          // Send email to each super admin using your notification service
          for (const admin of superAdmins) {
            await sendEmailNotification(
              admin.email,
              `🚨 Stalled Pipeline Alert - Order #${pipeline.order?.order_number}`,
              emailHtml,
              {
                job: 'stalled_pipeline_check',
                orderId: pipeline.order_id,
                adminId: admin.id,
              }
            );
          }

          // Also send SMS alert for critical stalls (over 2 hours)
          if (stalledMinutes > 120 && pipeline.order?.school?.phone) {
            await sendSmsNotification(
              pipeline.order.school.phone,
              `RESQID ALERT: Order #${pipeline.order?.order_number} has been stalled for ${stalledMinutes} minutes. Please check dashboard immediately.`,
              { job: 'stalled_pipeline_check', orderId: pipeline.order_id }
            );
          }
        }
      } catch (err) {
        logger.error(
          {
            job: 'stalled_pipeline_check',
            orderId: pipeline.order_id,
            error: err.message,
          },
          'Failed to process stalled pipeline'
        );
      }
    }

    logger.info(
      {
        job: 'stalled_pipeline_check',
        durationMs: Date.now() - startTime,
      },
      'Job completed'
    );
  } catch (error) {
    logger.error(
      {
        job: 'stalled_pipeline_check',
        error: error.message,
      },
      'Job failed'
    );
  }
}

// =============================================================================
// JOB 2: Check Dead Letter Queue
// =============================================================================

async function checkDeadLetterQueue() {
  const startTime = Date.now();
  logger.info({ job: 'dlq_check' }, 'Job started');

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
      logger.warn(
        {
          job: 'dlq_check',
          unresolvedCount,
          oldest: dlqEntries[dlqEntries.length - 1]?.created_at,
        },
        'Unresolved DLQ entries'
      );

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

        const emailHtml = `
          <div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto;">
            <h1 style="color: #ff8844;">⚠️ Dead Letter Queue Alert</h1>
            <p><strong>Total Unresolved:</strong> ${unresolvedCount}</p>
            <p><strong>Jobs by Type:</strong></p>
            <ul>
              ${Object.entries(jobsByType)
                .map(([type, count]) => `<li>${type}: ${count}</li>`)
                .join('')}
            </ul>
            <p><strong>Oldest Entry:</strong> ${dlqEntries[dlqEntries.length - 1]?.created_at}</p>
            <p>Please review the Dead Letter Queue in the admin dashboard.</p>
            <hr />
            <p style="color: #666; font-size: 12px;">RESQID System Monitor</p>
          </div>
        `;

        for (const admin of superAdmins) {
          await sendEmailNotification(
            admin.email,
            `⚠️ DLQ Alert - ${unresolvedCount} Unresolved Jobs`,
            emailHtml,
            { job: 'dlq_check', adminId: admin.id }
          );
        }
      }
    }

    // Store DLQ metrics in Redis
    await redis.set('orch:dlq:unresolved_count', unresolvedCount);
    await redis.expire('orch:dlq:unresolved_count', 3600);

    logger.info(
      {
        job: 'dlq_check',
        unresolvedCount,
        durationMs: Date.now() - startTime,
      },
      'Job completed'
    );
  } catch (error) {
    logger.error(
      {
        job: 'dlq_check',
        error: error.message,
      },
      'Job failed'
    );
  }
}

// =============================================================================
// JOB 3: Send Overdue Invoice Reminders
// =============================================================================

async function sendOverdueInvoiceReminders() {
  const startTime = Date.now();
  logger.info({ job: 'overdue_invoice_reminder' }, 'Job started');

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

    logger.info(
      {
        job: 'overdue_invoice_reminder',
        count: overdueInvoices.length,
      },
      'Overdue invoices found'
    );

    for (const invoice of overdueInvoices) {
      try {
        const daysOverdue = Math.floor(
          (Date.now() - new Date(invoice.due_at).getTime()) / (1000 * 60 * 60 * 24)
        );

        // Only send reminder if not already sent today
        const lastReminderKey = `invoice:reminder:${invoice.id}`;
        const lastSent = await redis.get(lastReminderKey);

        if (!lastSent || daysOverdue % 3 === 0) {
          const emailHtml = `
            <div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto;">
              <h1 style="color: #ff8844;">⚠️ Invoice Overdue</h1>
              <p>Dear ${invoice.order?.school?.name || 'School'},</p>
              <p>Invoice <strong>${invoice.invoice_number}</strong> is now overdue by <strong>${daysOverdue}</strong> days.</p>
              <p><strong>Amount Due:</strong> ₹${(invoice.total_amount / 100).toFixed(2)}</p>
              <p><strong>Due Date:</strong> ${new Date(invoice.due_at).toLocaleDateString()}</p>
              <p>Please make the payment at your earliest convenience to avoid service disruption.</p>
              <a href="https://resqid.com/dashboard/invoices/${invoice.id}" 
                 style="display: inline-block; padding: 10px 20px; background-color: #ff8844; color: white; text-decoration: none; border-radius: 5px;">
                Pay Now
              </a>
              <hr />
              <p style="color: #666; font-size: 12px;">RESQID - Student Safety Platform</p>
            </div>
          `;

          await sendEmailNotification(
            invoice.order?.school?.email,
            `⚠️ Invoice Overdue - ${invoice.invoice_number}`,
            emailHtml,
            { job: 'overdue_invoice_reminder', invoiceId: invoice.id, daysOverdue }
          );

          // Send SMS for high-value overdue invoices (> ₹10,000)
          if (invoice.total_amount > 1000000 && invoice.order?.school?.phone) {
            await sendSmsNotification(
              invoice.order.school.phone,
              `RESQID: Invoice ${invoice.invoice_number} is overdue by ${daysOverdue} days. Amount: ₹${(invoice.total_amount / 100).toFixed(2)}. Please pay immediately.`,
              { job: 'overdue_invoice_reminder', invoiceId: invoice.id }
            );
          }

          await redis.set(lastReminderKey, Date.now(), 'EX', 86400); // 1 day TTL

          logger.info(
            {
              job: 'overdue_invoice_reminder',
              invoiceId: invoice.id,
              daysOverdue,
            },
            'Overdue invoice reminder sent'
          );
        }
      } catch (err) {
        logger.error(
          {
            job: 'overdue_invoice_reminder',
            invoiceId: invoice.id,
            error: err.message,
          },
          'Failed to send overdue reminder'
        );
      }
    }

    logger.info(
      {
        job: 'overdue_invoice_reminder',
        processed: overdueInvoices.length,
        durationMs: Date.now() - startTime,
      },
      'Job completed'
    );
  } catch (error) {
    logger.error(
      {
        job: 'overdue_invoice_reminder',
        error: error.message,
      },
      'Job failed'
    );
  }
}

// =============================================================================
// JOB 4: Clean Up Old Logs
// =============================================================================

async function cleanupOldLogs() {
  const startTime = Date.now();
  logger.info({ job: 'log_cleanup' }, 'Job started');

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

    logger.info(
      {
        job: 'log_cleanup',
        deletedStepLogs: deletedStepLogs.count,
        deletedStatusLogs: deletedStatusLogs.count,
        deletedAuditLogs: deletedAuditLogs.count,
        durationMs: Date.now() - startTime,
      },
      'Job completed'
    );
  } catch (error) {
    logger.error(
      {
        job: 'log_cleanup',
        error: error.message,
      },
      'Job failed'
    );
  }
}

// =============================================================================
// JOB 5: Check Pending Payments
// =============================================================================

async function checkPendingPayments() {
  const startTime = Date.now();
  logger.info({ job: 'pending_payment_check' }, 'Job started');

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

    logger.info(
      {
        job: 'pending_payment_check',
        count: pendingOrders.length,
      },
      'Pending payments found'
    );

    for (const order of pendingOrders) {
      try {
        const daysOverdue = Math.floor(
          (Date.now() - new Date(order.balance_due_at).getTime()) / (1000 * 60 * 60 * 24)
        );

        // Send reminder only for overdue payments
        if (daysOverdue >= 0) {
          const emailHtml = `
            <div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto;">
              <h1 style="color: #ff8844;">⚠️ Payment Reminder</h1>
              <p>Dear ${order.school?.name || 'School'},</p>
              <p>Your order <strong>${order.order_number}</strong> has a pending balance payment.</p>
              <p><strong>Balance Amount:</strong> ₹${(order.balance_amount / 100).toFixed(2)}</p>
              <p><strong>Due Date:</strong> ${new Date(order.balance_due_at).toLocaleDateString()}</p>
              <p><strong>Days Overdue:</strong> ${daysOverdue}</p>
              <p>Please complete the payment to continue with your order processing.</p>
              <a href="https://resqid.com/dashboard/orders/${order.id}" 
                 style="display: inline-block; padding: 10px 20px; background-color: #ff8844; color: white; text-decoration: none; border-radius: 5px;">
                View Order
              </a>
              <hr />
              <p style="color: #666; font-size: 12px;">RESQID - Student Safety Platform</p>
            </div>
          `;

          await sendEmailNotification(
            order.school?.email,
            `⚠️ Payment Reminder - Order ${order.order_number}`,
            emailHtml,
            { job: 'pending_payment_check', orderId: order.id, daysOverdue }
          );

          logger.info(
            {
              job: 'pending_payment_check',
              orderId: order.id,
              daysOverdue,
            },
            'Payment overdue reminder sent'
          );
        }
      } catch (err) {
        logger.error(
          {
            job: 'pending_payment_check',
            orderId: order.id,
            error: err.message,
          },
          'Failed to send payment reminder'
        );
      }
    }

    logger.info(
      {
        job: 'pending_payment_check',
        processed: pendingOrders.length,
        durationMs: Date.now() - startTime,
      },
      'Job completed'
    );
  } catch (error) {
    logger.error(
      {
        job: 'pending_payment_check',
        error: error.message,
      },
      'Job failed'
    );
  }
}

// =============================================================================
// JOB 6: Clean Up Old Redis Keys
// =============================================================================

async function cleanupOldRedisKeys() {
  const startTime = Date.now();
  logger.info({ job: 'redis_cleanup' }, 'Job started');

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

    logger.info(
      {
        job: 'redis_cleanup',
        deletedKeys: deletedCount,
        durationMs: Date.now() - startTime,
      },
      'Job completed'
    );
  } catch (error) {
    logger.error(
      {
        job: 'redis_cleanup',
        error: error.message,
      },
      'Job failed'
    );
  }
}

// =============================================================================
// JOB 7: Generate Daily Metrics Report
// =============================================================================

async function generateDailyMetrics() {
  const startTime = Date.now();
  logger.info({ job: 'daily_metrics' }, 'Job started');

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
    let queueHealth = { status: 'ok', queueCount: 0 };
    try {
      const queueKeys = await redis.keys('bull:*:id');
      queueHealth = {
        queueCount: queueKeys.length,
        status: 'ok',
      };
    } catch {
      queueHealth = { status: 'error' };
    }

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

      const emailHtml = `
        <div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto;">
          <h1 style="color: #ff8844;">📊 Daily Metrics Alert</h1>
          <p><strong>Date:</strong> ${metrics.date}</p>
          <p><strong>Stalled Orders:</strong> ${stalledOrders}</p>
          <p><strong>Completion Rate:</strong> ${metrics.orders.completionRate}%</p>
          <p><strong>Total Orders:</strong> ${totalOrders}</p>
          <p><strong>Completed:</strong> ${completedOrders}</p>
          <p><strong>Cancelled:</strong> ${cancelledOrders}</p>
          <p><strong>Yesterday's Revenue:</strong> ₹${metrics.payments.yesterdayTotal}</p>
          <p>Please review the dashboard for more details.</p>
          <a href="https://resqid.com/admin/metrics" 
             style="display: inline-block; padding: 10px 20px; background-color: #ff8844; color: white; text-decoration: none; border-radius: 5px;">
            View Dashboard
          </a>
          <hr />
          <p style="color: #666; font-size: 12px;">RESQID System Monitor</p>
        </div>
      `;

      for (const admin of superAdmins) {
        await sendEmailNotification(
          admin.email,
          `📊 Daily Metrics Alert - ${stalledOrders} Stalled Orders`,
          emailHtml,
          { job: 'daily_metrics', adminId: admin.id }
        );
      }
    }

    logger.info(
      {
        job: 'daily_metrics',
        metrics,
        durationMs: Date.now() - startTime,
      },
      'Job completed'
    );
  } catch (error) {
    logger.error(
      {
        job: 'daily_metrics',
        error: error.message,
      },
      'Job failed'
    );
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
      cron.schedule(JOB_CONFIG.DAILY_METRICS, generateDailyMetrics),
    ];

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
