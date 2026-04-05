// =============================================================================
// scan-logs.routes.js — RESQID Super Admin Scan Logs
// Routes for scan log management
// =============================================================================

import { Router } from 'express';
import {
  listScanLogs,
  getScanLogById,
  getScanLogStats,
  getScanLogFilters,
} from './scan-logs.controller.js';

const router = Router();

router.get('/', listScanLogs);
router.get('/stats', getScanLogStats);
router.get('/filters', getScanLogFilters);
router.get('/:id', getScanLogById);

export default router;
