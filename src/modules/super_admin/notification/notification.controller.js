// =============================================================================
// notification.controller.js — RESQID Super Admin
// HTTP layer only — validates input, calls service, sends ApiResponse
// =============================================================================

import { ApiResponse } from '#shared/response/ApiResponse.js';
import { ApiError }    from '#shared/response/ApiError.js';
import { asyncHandler } from '#shared/response/asyncHandler.js';
import {
  listNotificationsSchema,
  notificationStatsSchema,
  notificationIdSchema,
} from './notification.validation.js';
import * as Service from './notification.service.js';

// ─── GET /api/super-admin/notifications/stats ─────────────────────────────────
// Must be registered BEFORE /:id route to avoid "stats" being parsed as an id

export const getStats = asyncHandler(async (req, res) => {
  const parsed = notificationStatsSchema.safeParse(req.query);
  if (!parsed.success) {
    throw ApiError.validationError('Invalid stats query params', parsed.error.errors);
  }

  const stats = await Service.getNotificationStats(parsed.data);

  return ApiResponse.ok(res, stats, 'Notification stats retrieved');
});

// ─── GET /api/super-admin/notifications ──────────────────────────────────────

export const listNotifications = asyncHandler(async (req, res) => {
  const parsed = listNotificationsSchema.safeParse(req.query);
  if (!parsed.success) {
    throw ApiError.validationError('Invalid query params', parsed.error.errors);
  }

  const { data, meta } = await Service.listNotifications(parsed.data);

  return ApiResponse.paginated(res, data, meta, 'Notifications retrieved');
});

// ─── GET /api/super-admin/notifications/:id ───────────────────────────────────

export const getNotificationById = asyncHandler(async (req, res) => {
  const parsed = notificationIdSchema.safeParse(req.params);
  if (!parsed.success) {
    throw ApiError.validationError('Invalid notification id', parsed.error.errors);
  }

  const notification = await Service.getNotificationById(parsed.data.id);

  return ApiResponse.ok(res, notification, 'Notification retrieved');
});