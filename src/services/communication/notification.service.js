// =============================================================================
// notification.service.js — Global notification service
// Environment-aware: DEV = log only, PROD = actual send
// =============================================================================

import { logger } from '#config/logger.js';
import { getQueue } from '#modules/order/order_orchestrator/queues/queue.manager.js';
import {
  QUEUE_NAMES,
  JOB_NAMES,
} from '#modules/order/order_orchestrator/orchestrator.constants.js';

const NODE_ENV = process.env.NODE_ENV || 'development';
const IS_PRODUCTION = NODE_ENV === 'production';

class NotificationService {
  /**
   * Send notification — queues job in both DEV and PROD
   * In DEV: job processes but only logs, doesn't actually send
   * In PROD: job processes and sends real notifications
   */
  async send(type, recipient, data, channels = ['email', 'sms']) {
    const payload = {
      type,
      recipient: {
        id: recipient.id,
        email: recipient.email,
        phone: recipient.phone,
        type: recipient.type, // "SCHOOL" | "SUPER_ADMIN" | "PARENT" | 'VENDOR'
      },
      data,
      channels,
      environment: IS_PRODUCTION ? 'production' : 'development',
    };

    const queue = getQueue(QUEUE_NAMES.NOTIFICATION);

    const job = await queue.add(JOB_NAMES.NOTIFY, payload, {
      jobId: `notify:${type}:${recipient.id}:${Date.now()}`,
      attempts: IS_PRODUCTION ? 3 : 1,
      backoff: { type: 'exponential', delay: 2000 },
      removeOnComplete: { count: 100 },
      removeOnFail: false,
    });

    if (!IS_PRODUCTION) {
      logger.info({
        msg: '[DEV] Notification queued (will not send)',
        type,
        recipient: recipient.id,
        data,
        jobId: job.id,
      });
    } else {
      logger.info({
        msg: 'Notification queued',
        type,
        recipient: recipient.id,
        jobId: job.id,
      });
    }

    return job;
  }

  /**
   * Send order notification — convenience method for schools
   */
  async notifyOrder(type, order, school, extraData = {}) {
    const recipient = {
      id: school.id,
      email: school.email,
      phone: school.phone,
      type: 'SCHOOL',
    };

    const data = {
      orderNumber: order.order_number,
      orderType: order.order_type,
      cardCount: order.card_count,
      status: order.status,
      schoolName: school.name,
      createdAt: order.created_at?.toISOString(),
      ...extraData,
    };

    return this.send(type, recipient, data, ['email', 'sms']);
  }

  /**
   * Notify super admin (for escalations)
   */
  async notifySuperAdmin(type, order, admin, extraData = {}) {
    const recipient = {
      id: admin.id,
      email: admin.email,
      phone: admin.phone,
      type: 'SUPER_ADMIN',
    };

    const data = {
      orderNumber: order?.order_number || 'N/A',
      schoolId: order?.school_id,
      ...extraData,
    };

    return this.send(type, recipient, data, ['email']);
  }

  /**
   * Notify vendor
   */
  async notifyVendor(type, order, vendor, extraData = {}) {
    const recipient = {
      id: vendor.id,
      email: vendor.email,
      phone: vendor.phone,
      type: 'VENDOR',
    };

    const data = {
      orderNumber: order.order_number,
      schoolName: order.school?.name,
      cardCount: order.card_count,
      vendorName: vendor.name,
      ...extraData,
    };

    return this.send(type, recipient, data, ['email', 'sms']);
  }

  /**
   * Send batch notifications (multiple recipients)
   */
  async notifyBatch(type, recipients, data, channels = ['email']) {
    const results = [];
    for (const recipient of recipients) {
      results.push(await this.send(type, recipient, data, channels));
    }
    return results;
  }
}

export const notificationService = new NotificationService();
