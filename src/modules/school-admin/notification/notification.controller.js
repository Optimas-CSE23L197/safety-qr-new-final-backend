// =============================================================================
// modules/school_admin/notifications/notification.controller.js — RESQID
// =============================================================================

import { getNotificationInventory, markOneRead, markAllRead } from './notification.service.js';
import { logger } from '#config/logger.js';

/**
 * GET /api/school-admin/:schoolId/notifications
 *
 * Query params (all optional):
 *   filter  — "ALL" (default) | "UNREAD" | any NotificationType value
 *             e.g. "SCAN_ANOMALY" | "CARD_EXPIRING" | 'SYSTEM' etc.
 *   page    — positive integer  (default: 1)
 *   limit   — 1–100            (default: 20)
 *
 * Response:
 * {
 *   success: true,
 *   data: {
 *     notifications: [...],
 *     stats: { unread },
 *     meta: { total, page, limit, totalPages, hasNextPage, hasPrevPage }
 *   }
 * }
 */
export async function listNotifications(req, res) {
  const { schoolId } = req.validatedParams;

  try {
    const result = await getNotificationInventory(schoolId, req.validatedQuery);
    return res.status(200).json({ success: true, data: result });
  } catch (err) {
    logger.error({ schoolId, err: err.message }, 'Notification list fetch failed');
    return res.status(500).json({
      success: false,
      code: 'INTERNAL_ERROR',
      message: 'Failed to fetch notifications',
    });
  }
}

/**
 * PATCH /api/school-admin/:schoolId/notifications/:notificationId/read
 *
 * Marks a single QUEUED notification as SENT (read).
 * No body required.
 *
 * Response:
 * {
 *   success: true,
 *   data: { notification: { ...updatedNotification } }
 * }
 *
 * Errors:
 *   404 — not found, wrong school, or already read
 */
export async function markNotificationRead(req, res) {
  const { schoolId, notificationId } = req.validatedParams;

  try {
    const notification = await markOneRead({ notificationId, schoolId });

    if (!notification) {
      return res.status(404).json({
        success: false,
        code: 'NOT_FOUND',
        message: 'Notification not found or already read',
      });
    }

    return res.status(200).json({ success: true, data: { notification } });
  } catch (err) {
    logger.error({ schoolId, notificationId, err: err.message }, 'Mark notification read failed');
    return res.status(500).json({
      success: false,
      code: 'INTERNAL_ERROR',
      message: 'Failed to mark notification as read',
    });
  }
}

/**
 * PATCH /api/school-admin/:schoolId/notifications/read-all
 *
 * Bulk-marks ALL unread (QUEUED) notifications as read (SENT) for the school.
 * No body required.
 *
 * Response:
 * {
 *   success: true,
 *   data: { count: 12 }   // how many were marked read
 * }
 */
export async function markAllNotificationsRead(req, res) {
  const { schoolId } = req.validatedParams;

  try {
    const result = await markAllRead(schoolId);
    return res.status(200).json({ success: true, data: result });
  } catch (err) {
    logger.error({ schoolId, err: err.message }, 'Mark all notifications read failed');
    return res.status(500).json({
      success: false,
      code: 'INTERNAL_ERROR',
      message: 'Failed to mark all notifications as read',
    });
  }
}
