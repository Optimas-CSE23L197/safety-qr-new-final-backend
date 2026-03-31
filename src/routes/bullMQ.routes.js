// =============================================================================
// routes/bullMQ.routes.js — RESQID
// Bull Board dashboard — super admin only
// Accessible at: /api/admin/queues
// =============================================================================

import { createBullBoard } from '@bull-board/api';
import { BullMQAdapter } from '@bull-board/api/bullMQAdapter';
import { ExpressAdapter } from '@bull-board/express';
import { Router } from 'express';
import {
  emergencyAlertsQueue,
  notificationsQueue,
  backgroundJobsQueue,
} from '#orchestrator/queues/queue.config.js';
import { authenticate } from '#middleware/auth/auth.middleware.js';
import { requireSuperAdmin } from '#middleware/auth/rbac.middleware.js';

// ── Bull Board setup ──────────────────────────────────────────────────────────
const serverAdapter = new ExpressAdapter();
serverAdapter.setBasePath('/api/admin/queues');

createBullBoard({
  queues: [
    new BullMQAdapter(emergencyAlertsQueue),
    new BullMQAdapter(notificationsQueue),
    new BullMQAdapter(backgroundJobsQueue),
  ],
  serverAdapter,
});

// ── Router ────────────────────────────────────────────────────────────────────
const router = Router();

router.use('/', serverAdapter.getRouter());

export default router;
