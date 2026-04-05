// =============================================================================
// subscriptions.routes.js — RESQID Super Admin
// All routes: authenticated + SUPER_ADMIN only
// =============================================================================

import { Router } from 'express';
import { authenticate }    from '#middleware/auth.middleware.js';
import { requireSuperAdmin } from '#middleware/rbac.middleware.js';
import {
  listSubscriptions,
  getSubscriptionStats,
  getSubscription,
  updateSubscription,
  cancelSubscription,
} from './subscriptions.controller.js';

const router = Router();

// Apply auth + role guard to every route in this file
router.use(authenticate, requireSuperAdmin);

// ─── Stats (before /:id to avoid param collision) ────────────────────────────
// GET /api/super-admin/subscriptions/stats
router.get('/stats', getSubscriptionStats);

// ─── Collection ──────────────────────────────────────────────────────────────
// GET /api/super-admin/subscriptions?status=ACTIVE&plan=BASIC&search=DPS&page=1&limit=20
router.get('/', listSubscriptions);

// ─── Single Resource ─────────────────────────────────────────────────────────
// GET    /api/super-admin/subscriptions/:id
// PATCH  /api/super-admin/subscriptions/:id
router.get('/:id',   getSubscription);
router.patch('/:id', updateSubscription);

// ─── Actions ─────────────────────────────────────────────────────────────────
// POST /api/super-admin/subscriptions/:id/cancel
router.post('/:id/cancel', cancelSubscription);

export default router;