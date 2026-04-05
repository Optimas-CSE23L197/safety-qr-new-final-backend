// =============================================================================
// subscriptions.controller.js — RESQID Super Admin
// HTTP layer only — parse request, call service, send response
// No business logic here
// =============================================================================

import { ApiResponse } from '#shared/response/ApiResponse.js';
import { ApiError }    from '#shared/response/ApiError.js';
import { asyncHandler } from '#shared/response/asyncHandler.js';
import * as SubscriptionService from './subscriptions.service.js';
import {
  listSubscriptionsSchema,
  updateSubscriptionSchema,
  cancelSubscriptionSchema,
} from './subscriptions.validation.js';

// ─── GET /subscriptions ───────────────────────────────────────────────────────

export const listSubscriptions = asyncHandler(async (req, res) => {
  const query = listSubscriptionsSchema.parse(req.query);

  const { data, meta } = await SubscriptionService.listSubscriptions(query);

  return ApiResponse.paginated(res, data, meta, 'Subscriptions fetched successfully');
});

// ─── GET /subscriptions/stats ─────────────────────────────────────────────────

export const getSubscriptionStats = asyncHandler(async (_req, res) => {
  const stats = await SubscriptionService.getSubscriptionStats();

  return ApiResponse.ok(res, stats, 'Subscription stats fetched successfully');
});

// ─── GET /subscriptions/:id ───────────────────────────────────────────────────

export const getSubscription = asyncHandler(async (req, res) => {
  const { id } = req.params;

  const subscription = await SubscriptionService.getSubscription(id);

  return ApiResponse.ok(res, subscription, 'Subscription fetched successfully');
});

// ─── PATCH /subscriptions/:id ─────────────────────────────────────────────────

export const updateSubscription = asyncHandler(async (req, res) => {
  const { id } = req.params;

  const body = updateSubscriptionSchema.parse(req.body);

  const actorContext = {
    actorId: req.userId,
    ip:      req.ip ?? req.headers['x-forwarded-for'] ?? null,
  };

  const updated = await SubscriptionService.updateSubscription(id, body, actorContext);

  return ApiResponse.ok(res, updated, 'Subscription updated successfully');
});

// ─── POST /subscriptions/:id/cancel ──────────────────────────────────────────

export const cancelSubscription = asyncHandler(async (req, res) => {
  const { id } = req.params;

  const body = cancelSubscriptionSchema.parse(req.body);

  const actorContext = {
    actorId: req.userId,
    ip:      req.ip ?? req.headers['x-forwarded-for'] ?? null,
  };

  const canceled = await SubscriptionService.cancelSubscription(id, body, actorContext);

  return ApiResponse.ok(res, canceled, 'Subscription canceled successfully');
});