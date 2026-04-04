// =============================================================================
// dashboard.controller.js — RESQID Super Admin Dashboard
// HTTP handlers for platform-wide analytics endpoints
// =============================================================================

import { asyncHandler } from '../../../shared/response/asyncHandler.js';
import { ApiResponse } from '../../../shared/response/ApiResponse.js';
import { DashboardService } from './dashboard.service.js';
import {
  dashboardStatsQuerySchema,
  dashboardGrowthQuerySchema,
  dashboardSubscriptionBreakdownQuerySchema,
  dashboardRecentSchoolsQuerySchema,
  dashboardRecentAuditQuerySchema,
} from './dashboard.validation.js';

const dashboardService = new DashboardService();

export const getDashboardStats = asyncHandler(async (req, res) => {
  const filters = dashboardStatsQuerySchema.parse(req.query);
  const stats = await dashboardService.getStats(filters);
  return ApiResponse.ok(res, stats, 'Dashboard stats fetched successfully');
});

export const getDashboardGrowth = asyncHandler(async (req, res) => {
  const { months, school_id } = dashboardGrowthQuerySchema.parse(req.query);
  const growth = await dashboardService.getGrowth(months, school_id);
  return ApiResponse.ok(res, growth, 'Growth data fetched successfully');
});

export const getSubscriptionBreakdown = asyncHandler(async (req, res) => {
  const { school_id } = dashboardSubscriptionBreakdownQuerySchema.parse(req.query);
  const breakdown = await dashboardService.getSubscriptionBreakdown(school_id);
  return ApiResponse.ok(res, breakdown, 'Subscription breakdown fetched successfully');
});

export const getRecentSchools = asyncHandler(async (req, res) => {
  const { limit } = dashboardRecentSchoolsQuerySchema.parse(req.query);
  const schools = await dashboardService.getRecentSchools(limit);
  return ApiResponse.ok(res, schools, 'Recent schools fetched successfully');
});

export const getRecentAuditLogs = asyncHandler(async (req, res) => {
  const { limit, actor_type } = dashboardRecentAuditQuerySchema.parse(req.query);
  const logs = await dashboardService.getRecentAuditLogs(limit, actor_type);
  return ApiResponse.ok(res, logs, 'Recent audit logs fetched successfully');
});

export const getSystemHealth = asyncHandler(async (req, res) => {
  const health = await dashboardService.getSystemHealth();
  return ApiResponse.ok(res, health, 'System health fetched successfully');
});

export const getCompleteDashboard = asyncHandler(async (req, res) => {
  const filters = {
    ...dashboardStatsQuerySchema.parse(req.query),
    months: req.query.months ? parseInt(req.query.months) : 12,
    recentSchoolsLimit: req.query.recentSchoolsLimit ? parseInt(req.query.recentSchoolsLimit) : 10,
    auditLimit: req.query.auditLimit ? parseInt(req.query.auditLimit) : 20,
    actor_type: req.query.actor_type,
  };
  const dashboard = await dashboardService.getCompleteDashboard(filters);
  return ApiResponse.ok(res, dashboard, 'Complete dashboard data fetched successfully');
});
