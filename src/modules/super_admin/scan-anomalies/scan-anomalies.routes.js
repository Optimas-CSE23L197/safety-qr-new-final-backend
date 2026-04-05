// =============================================================================
// scan-anomalies.routes.js — RESQID Super Admin Scan Anomalies
// Routes for scan anomaly management
// =============================================================================

import { Router } from 'express';
import {
  listAnomalies,
  getAnomalyById,
  resolveAnomaly,
  getAnomalyStats,
  getAnomalyFilters,
} from './scan-anomalies.controller.js';

const router = Router();

router.get('/', listAnomalies);
router.get('/stats', getAnomalyStats);
router.get('/filters', getAnomalyFilters);
router.get('/:id', getAnomalyById);
router.patch('/:id/resolve', resolveAnomaly);

export default router;
