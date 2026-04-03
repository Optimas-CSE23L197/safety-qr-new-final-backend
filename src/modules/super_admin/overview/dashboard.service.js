// =============================================================================
// dashboard.service.js — RESQID Super Admin Dashboard
// Business logic orchestration for platform-wide metrics
// =============================================================================

import { DashboardRepository } from './dashboard.repository.js';
import { ApiError } from '#shared/response/ApiError.js';

export class DashboardService {
  constructor() {
    this.repository = new DashboardRepository();
  }

  async getStats(filters) {
    try {
      return await this.repository.getPlatformStats(filters);
    } catch (error) {
      throw ApiError.internal('Failed to fetch dashboard stats');
    }
  }

  async getGrowth(months, schoolId) {
    try {
      return await this.repository.getSchoolGrowth(months, schoolId);
    } catch (error) {
      throw ApiError.internal('Failed to fetch growth data');
    }
  }

  async getSubscriptionBreakdown(schoolId) {
    try {
      return await this.repository.getSubscriptionBreakdown(schoolId);
    } catch (error) {
      throw ApiError.internal('Failed to fetch subscription breakdown');
    }
  }

  async getRecentSchools(limit) {
    try {
      return await this.repository.getRecentSchools(limit);
    } catch (error) {
      throw ApiError.internal('Failed to fetch recent schools');
    }
  }

  async getRecentAuditLogs(limit, actorType) {
    try {
      return await this.repository.getRecentAuditLogs(limit, actorType);
    } catch (error) {
      throw ApiError.internal('Failed to fetch audit logs');
    }
  }

  async getSystemHealth() {
    try {
      return await this.repository.getSystemHealthSnapshot();
    } catch (error) {
      throw ApiError.internal('Failed to fetch system health');
    }
  }

  async getCompleteDashboard(filters) {
    const [stats, growth, subscriptionBreakdown, recentSchools, recentAudit, systemHealth] =
      await Promise.all([
        this.getStats(filters),
        this.getGrowth(filters.months || 12, filters.school_id),
        this.getSubscriptionBreakdown(filters.school_id),
        this.getRecentSchools(filters.recentSchoolsLimit || 10),
        this.getRecentAuditLogs(filters.auditLimit || 20, filters.actor_type),
        this.getSystemHealth(),
      ]);

    return {
      stats,
      growth,
      subscriptionBreakdown,
      recentSchools,
      recentAudit,
      systemHealth,
    };
  }
}
