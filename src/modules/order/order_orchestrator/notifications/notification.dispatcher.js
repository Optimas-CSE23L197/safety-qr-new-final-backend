// =============================================================================
// notifications/notification.dispatcher.js
// Environment-aware notification dispatcher
// =============================================================================

import { Worker } from 'bullmq';
import { workerRedis } from '#config/redis.js'; // ✅ Use workerRedis for BullMQ
import { logger } from '#config/logger.js';
import { QUEUE_NAMES, JOB_NAMES, IDEMPOTENCY_TTL_SECONDS } from './orchestrator.constants.js';
import { getQueue } from './queues/queue.manager.js';
import { claimExecution, markCompleted, releaseClaim } from '#services/idempotency.service.js';
import { prisma } from '#config/database/prisma.js';

// Import notification services
import { sendEmail } from '#services/communication/email.service.js';
import { sendSms } from '#services/communication/sms.service.js';
import { sendPush } from '#services/communication/push.service.js';

const WORKER_NAME = 'notification-dispatcher';
const NODE_ENV = process.env.NODE_ENV || 'development';
const IS_PRODUCTION = NODE_ENV === 'production';

// =============================================================================
// TEMPLATES
// =============================================================================

const TEMPLATES = {
  ORDER_CREATED: {
    email: {
      subject: 'Order Created - #{orderNumber}',
      body: 'Dear #{schoolName},\n\nYour order #{orderNumber} has been created and is pending approval.\n\nOrder Details:\n- Type: #{orderType}\n- Cards: #{cardCount}\n\nThank you,\nResQID Team',
    },
    sms: 'ResQID: Order #{orderNumber} created and pending approval. #{cardCount} cards.',
    push: {
      title: 'Order Created',
      body: 'Order #{orderNumber} created and pending approval',
    },
  },
  ORDER_APPROVED: {
    email: {
      subject: 'Order Approved - #{orderNumber}',
      body: 'Dear #{schoolName},\n\nGreat news! Your order #{orderNumber} has been approved and is now processing.\n\nNext Steps:\n1. Advance payment invoice has been generated\n2. Please make the payment to proceed with production\n\nThank you,\nResQID Team',
    },
    sms: 'ResQID: Order #{orderNumber} approved. Advance invoice ready.',
    push: {
      title: 'Order Approved',
      body: 'Order #{orderNumber} approved. Advance invoice ready.',
    },
  },
  ADVANCE_PAYMENT_RECEIVED: {
    email: {
      subject: 'Advance Payment Received - Order #{orderNumber}',
      body: 'Dear #{schoolName},\n\nWe have received your advance payment of ₹#{amount} for order #{orderNumber}. Reference: #{reference}\n\nProduction will now begin.\n\nThank you,\nResQID Team',
    },
    sms: 'ResQID: Payment of ₹#{amount} received for order #{orderNumber}. Ref: #{reference}',
    push: {
      title: 'Payment Received',
      body: 'Advance payment of ₹#{amount} received for order #{orderNumber}',
    },
  },
  TOKEN_GENERATED: {
    email: {
      subject: 'Tokens Generated - Order #{orderNumber}',
      body: 'Dear #{schoolName},\n\nTokens have been successfully generated for your order #{orderNumber}.\n\nTotal Tokens: #{totalTokens}\n\nYou can now download the QR codes and begin assigning tokens to students.\n\nThank you,\nResQID Team',
    },
    sms: 'ResQID: #{totalTokens} tokens generated for order #{orderNumber}.',
  },
  CARD_DESIGN_READY: {
    email: {
      subject: 'Card Design Ready - Order #{orderNumber}',
      body: 'Dear #{schoolName},\n\nCard designs for order #{orderNumber} are ready for printing.\n\nThank you,\nResQID Team',
    },
    sms: 'ResQID: Card designs ready for order #{orderNumber}.',
  },
  PRINTING_STARTED: {
    email: {
      subject: 'Printing Started - Order #{orderNumber}',
      body: 'Dear #{schoolName},\n\nYour cards are now being printed! Expected completion: #{expectedDays} days.\n\nThank you,\nResQID Team',
    },
    sms: 'ResQID: Printing started for order #{orderNumber}. Expected: #{expectedDays} days.',
    push: {
      title: 'Printing Started',
      body: 'Your cards for order #{orderNumber} are now being printed',
    },
  },
  SHIPPED: {
    email: {
      subject: 'Order Shipped - #{orderNumber}',
      body: 'Dear #{schoolName},\n\nYour order #{orderNumber} has been shipped!\n\nTracking: #{awbCode}\nTrack at: #{trackingUrl}\nCourier: #{courierName}\n\nThank you,\nResQID Team',
    },
    sms: 'ResQID: Order #{orderNumber} shipped. Track: #{trackingUrl}',
    push: {
      title: 'Order Shipped',
      body: 'Your order #{orderNumber} has been shipped',
    },
  },
  DELIVERED: {
    email: {
      subject: 'Order Delivered - #{orderNumber}',
      body: 'Dear #{schoolName},\n\nYour order #{orderNumber} has been delivered!\n\nDelivered at: #{deliveredAt}\n\nThank you,\nResQID Team',
    },
    sms: 'ResQID: Order #{orderNumber} delivered. Thank you!',
    push: {
      title: 'Order Delivered',
      body: 'Your order #{orderNumber} has been delivered',
    },
  },
  BALANCE_INVOICE_READY: {
    email: {
      subject: 'Balance Payment Invoice Ready - Order #{orderNumber}',
      body: 'Dear #{schoolName},\n\nYour balance payment invoice (#{invoiceNumber}) of ₹#{amount} is ready. Please make the payment by #{dueDate}.\n\nThank you,\nResQID Team',
    },
    sms: 'ResQID: Balance invoice #{invoiceNumber} of ₹#{amount} ready for order #{orderNumber}. Due: #{dueDate}',
    push: {
      title: 'Balance Invoice Ready',
      body: 'Balance invoice of ₹#{amount} ready for order #{orderNumber}',
    },
  },
  ORDER_COMPLETED: {
    email: {
      subject: 'Order Completed - #{orderNumber}',
      body: 'Dear #{schoolName},\n\nYour order #{orderNumber} has been completed. Thank you for choosing ResQID!\n\nThank you,\nResQID Team',
    },
    sms: 'ResQID: Order #{orderNumber} completed. Thank you!',
    push: {
      title: 'Order Completed',
      body: 'Order #{orderNumber} completed successfully',
    },
  },
  ORDER_CANCELLED: {
    email: {
      subject: 'Order Cancelled - #{orderNumber}',
      body: 'Dear #{schoolName},\n\nYour order #{orderNumber} has been cancelled.\n\nReason: #{reason}\n\nIf you have any questions, please contact support.\n\nResQID Team',
    },
    sms: 'ResQID: Order #{orderNumber} cancelled. Reason: #{reason}',
    push: {
      title: 'Order Cancelled',
      body: 'Your order #{orderNumber} has been cancelled',
    },
  },
  STEP_FAILURE_ESCALATED: {
    email: {
      subject: 'URGENT: Order Step Failure - #{orderNumber}',
      body: '⚠️ URGENT ⚠️\n\nOrder #{orderNumber} has failed at step: #{step}\n\nError: #{error}\nRetry Count: #{retryCount}\n\nPlease investigate immediately.\n\nResQID System',
    },
    sms: 'URGENT: Order #{orderNumber} failed at step #{step}. Check dashboard.',
  },
  VENDOR_ASSIGNED: {
    email: {
      subject: 'New Order Assigned - #{orderNumber}',
      body: 'Dear #{vendorName},\n\nA new order has been assigned to you.\n\nOrder: #{orderNumber}\nSchool: #{schoolName}\nCards: #{cardCount}\n\nPlease process this order at your earliest convenience.\n\nResQID Team',
    },
    sms: 'ResQID: New order #{orderNumber} assigned. #{cardCount} cards to print.',
  },
};

// =============================================================================
// HELPERS
// =============================================================================

function interpolateTemplate(template, data) {
  let result = template;
  for (const [key, value] of Object.entries(data)) {
    result = result.replace(new RegExp(`#{${key}}`, 'g'), value);
  }
  return result;
}

async function getRecipientDetails(recipientId, recipientType) {
  if (recipientType === 'SUPER_ADMIN') {
    const admin = await prisma.superAdmin.findUnique({
      where: { id: recipientId },
      select: { email: true, name: true },
    });
    return { email: admin?.email, name: admin?.name };
  }

  if (recipientType === 'SCHOOL') {
    const school = await prisma.school.findUnique({
      where: { id: recipientId },
      select: { email: true, phone: true, name: true },
    });
    return { email: school?.email, phone: school?.phone, name: school?.name };
  }

  if (recipientType === 'VENDOR') {
    const vendor = await prisma.vendorProfile.findUnique({
      where: { id: recipientId },
      select: { email: true, phone: true, name: true },
    });
    return { email: vendor?.email, phone: vendor?.phone, name: vendor?.name };
  }

  if (recipientType === 'PARENT') {
    const parent = await prisma.parentUser.findUnique({
      where: { id: recipientId },
      select: { email: true, phone: true, name: true },
    });
    return { email: parent?.email, phone: parent?.phone, name: parent?.name };
  }

  return {};
}

async function sendToChannel(channel, recipient, notificationType, data) {
  const templateData = TEMPLATES[notificationType];
  if (!templateData || !templateData[channel]) {
    logger.warn({
      msg: 'No template for channel',
      channel,
      type: notificationType,
    });
    return false;
  }

  const message = interpolateTemplate(templateData[channel], data);

  try {
    switch (channel) {
      case 'email':
        await sendEmail(recipient, templateData[channel].subject, message);
        break;
      case 'sms':
        await sendSms(recipient, message);
        break;
      case 'push':
        await sendPush(recipient, message);
        break;
      default:
        return false;
    }
    return true;
  } catch (error) {
    logger.error({
      msg: 'Failed to send notification',
      channel,
      recipient,
      error: error.message,
    });
    return false;
  }
}

async function dispatchNotification(notification) {
  // ✅ DEV mode: log only, don't actually send
  if (!IS_PRODUCTION) {
    logger.info({
      msg: '[DEV] Notification would send:',
      type: notification.type,
      recipientId: notification.recipientId,
      recipientType: notification.recipientType,
      data: notification.templateData,
    });
    return {
      dispatched: true,
      simulated: true,
      channels: [],
      successes: 0,
    };
  }

  // ✅ PRODUCTION: actually send
  const recipientDetails = await getRecipientDetails(
    notification.recipientId,
    notification.recipientType
  );

  const data = {
    type: notification.type,
    orderId: notification.orderId,
    ...notification.templateData,
    ...recipientDetails,
  };

  const channels = [];

  if (recipientDetails.email) channels.push('email');
  if (recipientDetails.phone) channels.push('sms');
  if (notification.recipientType === 'PARENT') channels.push('push');

  const results = await Promise.all(
    channels.map(channel =>
      sendToChannel(
        channel,
        recipientDetails[channel] || notification.recipientId,
        notification.type,
        data
      )
    )
  );

  return {
    dispatched: results.some(r => r === true),
    channels: channels.length,
    successes: results.filter(r => r === true).length,
  };
}

// =============================================================================
// WORKER
// =============================================================================

export function createNotificationWorker() {
  logger.info({ msg: 'Creating notification worker', environment: NODE_ENV });

  const worker = new Worker(
    QUEUE_NAMES.NOTIFICATION,
    async job => {
      const { type, orderId, recipient, data, channels, environment, idempotencyKey } = job.data;

      logger.info({
        msg: 'Notification worker processing job',
        jobId: job.id,
        type,
        orderId,
        recipientId: recipient?.id,
        environment,
      });

      const idempotentKey = idempotencyKey || `${type}:${orderId}:${recipient?.id}:${Date.now()}`;
      const { claimed } = await claimExecution(
        orderId || 'global',
        `notification_${type}_${recipient?.id}`,
        IDEMPOTENCY_TTL_SECONDS
      );

      if (!claimed) {
        logger.info({
          msg: 'Notification already sent, skipping',
          jobId: job.id,
          type,
          orderId,
        });
        return { skipped: true, reason: 'Already sent' };
      }

      try {
        // Create notification record
        const notificationRecord = await prisma.notification.create({
          data: {
            school_id: recipient?.type === 'SCHOOL' ? recipient.id : null,
            parent_id: recipient?.type === 'PARENT' ? recipient.id : null,
            type: type,
            channel: channels?.[0] || 'EMAIL',
            status: 'QUEUED',
            payload: data,
            idempotency_key: idempotentKey,
          },
        });

        const result = await dispatchNotification({
          type,
          orderId,
          recipientId: recipient?.id,
          recipientType: recipient?.type,
          templateData: data,
        });

        // Update notification record
        await prisma.notification.update({
          where: { id: notificationRecord.id },
          data: {
            status: result.dispatched ? 'SENT' : 'FAILED',
            sent_at: result.dispatched ? new Date() : null,
            error: result.dispatched ? null : 'Failed to send via any channel',
          },
        });

        await markCompleted(orderId || 'global', `notification_${type}_${recipient?.id}`, result);

        logger.info({
          msg: 'Notification dispatched',
          jobId: job.id,
          type,
          orderId,
          result,
        });

        return result;
      } catch (error) {
        logger.error({
          msg: 'Notification worker failed',
          jobId: job.id,
          type,
          orderId,
          error: error.message,
        });

        await releaseClaim(orderId || 'global', `notification_${type}_${recipient?.id}`);
        throw error;
      }
    },
    {
      connection: { client: workerRedis }, // ✅ Use workerRedis for BullMQ
      concurrency: 10,
      autorun: false,
      settings: {
        stalledInterval: 30000,
        maxStalledCount: 3,
        lockDuration: 60000,
      },
    }
  );

  worker.on('completed', job => {
    logger.info({ msg: 'Notification worker job completed', jobId: job.id });
  });

  worker.on('failed', (job, err) => {
    logger.error({
      msg: 'Notification worker job failed',
      jobId: job?.id,
      error: err.message,
    });
  });

  worker.on('error', err => {
    logger.error({
      msg: 'Notification worker error',
      error: err.message,
    });
  });

  logger.info({ msg: 'Notification worker created', workerName: WORKER_NAME });

  return worker;
}
