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
  pipelineJobsQueue,
} from '#orchestrator/queues/queue.config.js';
import { authenticate } from '#middleware/auth/auth.middleware.js';
import { requireSuperAdmin } from '#middleware/auth/rbac.middleware.js';

// ── Bull Board setup ──────────────────────────────────────────────────────────
const serverAdapter = new ExpressAdapter();
serverAdapter.setBasePath('/api/admin/queues');

// Build queue list dynamically — only include instantiated queues
const queues = [new BullMQAdapter(emergencyAlertsQueue), new BullMQAdapter(notificationsQueue)];

// pipelineJobsQueue is null on Railway — only add if instantiated
if (pipelineJobsQueue) {
  queues.push(new BullMQAdapter(pipelineJobsQueue));
}

createBullBoard({
  queues,
  serverAdapter,
});

// ── Router ────────────────────────────────────────────────────────────────────
const router = Router();

// Protect with auth + super admin only
router.use('/', authenticate, requireSuperAdmin, serverAdapter.getRouter());

export default router;
