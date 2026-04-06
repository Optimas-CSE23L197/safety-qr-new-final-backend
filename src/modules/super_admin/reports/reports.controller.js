// =============================================================================
// reports.controller.js — RESQID Super Admin
// HTTP only — parse → call service → respond / stream CSV
// =============================================================================

import { ReportsService }      from './reports.service.js';
import { chartQuerySchema, exportQuerySchema } from './reports.validation.js';
import { ApiResponse }         from '#shared/response/ApiResponse.js';
import { ApiError }            from '#shared/response/ApiError.js';
import { asyncHandler }        from '#shared/response/asyncHandler.js';

// ─── CSV response helper ──────────────────────────────────────────────────────
function sendCSV(res, filename, csv) {
  res.setHeader('Content-Type', 'text/csv; charset=utf-8');
  res.setHeader('Content-Disposition', `attachment; filename="${filename}"`);
  // BOM for Excel UTF-8 compatibility (handles ₹ symbol)
  res.send('\uFEFF' + csv);
}

function dateSuffix() {
  return new Date().toISOString().slice(0, 10); // YYYY-MM-DD
}

// ─── Controller ───────────────────────────────────────────────────────────────
export const ReportsController = {

  // ── Chart data endpoints ───────────────────────────────────────────────────

  /**
   * GET /api/super-admin/reports/revenue?months=7
   * Returns [{ month: 'Aug', revenue: 312000, payment_count: 4 }, ...]
   */
  getMonthlyRevenue: asyncHandler(async (req, res) => {
    const parsed = chartQuerySchema.safeParse(req.query);
    if (!parsed.success) {
      throw ApiError.validationError('Invalid query', parsed.error.flatten().fieldErrors);
    }
    const data = await ReportsService.getMonthlyRevenue(parsed.data.months);
    return ApiResponse.ok(res, data, 'Monthly revenue fetched');
  }),

  /**
   * GET /api/super-admin/reports/scans?months=7
   * Returns [{ month: 'Aug', scans: 142000 }, ...]
   */
  getMonthlyScanVolume: asyncHandler(async (req, res) => {
    const parsed = chartQuerySchema.safeParse(req.query);
    if (!parsed.success) {
      throw ApiError.validationError('Invalid query', parsed.error.flatten().fieldErrors);
    }
    const data = await ReportsService.getMonthlyScanVolume(parsed.data.months);
    return ApiResponse.ok(res, data, 'Monthly scan volume fetched');
  }),

  // ── CSV export endpoints ───────────────────────────────────────────────────

  /**
   * GET /api/super-admin/reports/export/revenue?months=12
   * Downloads: revenue-report-YYYY-MM-DD.csv
   */
  exportRevenue: asyncHandler(async (req, res) => {
    const parsed = exportQuerySchema.safeParse(req.query);
    if (!parsed.success) {
      throw ApiError.validationError('Invalid query', parsed.error.flatten().fieldErrors);
    }
    const csv = await ReportsService.buildRevenueCSV(parsed.data.months);
    sendCSV(res, `revenue-report-${dateSuffix()}.csv`, csv);
  }),

  /**
   * GET /api/super-admin/reports/export/school-activity?months=1
   * Downloads: school-activity-YYYY-MM-DD.csv
   */
  exportSchoolActivity: asyncHandler(async (req, res) => {
    const parsed = exportQuerySchema.safeParse(req.query);
    if (!parsed.success) {
      throw ApiError.validationError('Invalid query', parsed.error.flatten().fieldErrors);
    }
    const csv = await ReportsService.buildSchoolActivityCSV(parsed.data.months);
    sendCSV(res, `school-activity-${dateSuffix()}.csv`, csv);
  }),

  /**
   * GET /api/super-admin/reports/export/platform-growth?months=6
   * Downloads: platform-growth-YYYY-MM-DD.csv
   */
  exportPlatformGrowth: asyncHandler(async (req, res) => {
    const parsed = exportQuerySchema.safeParse(req.query);
    if (!parsed.success) {
      throw ApiError.validationError('Invalid query', parsed.error.flatten().fieldErrors);
    }
    const csv = await ReportsService.buildPlatformGrowthCSV(parsed.data.months);
    sendCSV(res, `platform-growth-${dateSuffix()}.csv`, csv);
  }),

  /**
   * GET /api/super-admin/reports/export/subscription-cohort?months=3
   * Downloads: subscription-cohort-YYYY-MM-DD.csv
   */
  exportSubscriptionCohort: asyncHandler(async (req, res) => {
    const parsed = exportQuerySchema.safeParse(req.query);
    if (!parsed.success) {
      throw ApiError.validationError('Invalid query', parsed.error.flatten().fieldErrors);
    }
    const csv = await ReportsService.buildSubscriptionCohortCSV(parsed.data.months);
    sendCSV(res, `subscription-cohort-${dateSuffix()}.csv`, csv);
  }),
};