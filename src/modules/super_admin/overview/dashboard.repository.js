// =============================================================================
// dashboard.repository.js — RESQID Super Admin Dashboard
// Database aggregation queries for platform-wide KPIs
// =============================================================================

import { prisma } from '#config/prisma.js';

export class DashboardRepository {
  async getPlatformStats(filters = {}) {
    const { from_date, to_date, school_id } = filters;

    const dateFilter = {};
    if (from_date || to_date) {
      dateFilter.created_at = {};
      if (from_date) dateFilter.created_at.gte = new Date(from_date);
      if (to_date) dateFilter.created_at.lte = new Date(to_date);
    }

    const schoolFilter = school_id ? { id: school_id } : {};

    const [
      totalSchools,
      activeSchools,
      pastDueSchools,
      trialingSchools,
      totalStudents,
      studentsThisMonth,
      activeSubscriptions,
      mrrData,
    ] = await Promise.all([
      prisma.school.count({ where: { ...schoolFilter, is_active: true } }),
      prisma.school.count({
        where: { ...schoolFilter, is_active: true, subscriptions: { some: { status: 'ACTIVE' } } },
      }),
      prisma.school.count({
        where: { ...schoolFilter, subscriptions: { some: { status: 'PAST_DUE' } } },
      }),
      prisma.school.count({
        where: { ...schoolFilter, subscriptions: { some: { status: 'TRIALING' } } },
      }),
      prisma.student.count({ where: school_id ? { school_id } : {} }),
      prisma.student.count({
        where: {
          ...(school_id && { school_id }),
          created_at: { gte: new Date(new Date().getFullYear(), new Date().getMonth(), 1) },
        },
      }),
      prisma.subscription.count({
        where: {
          school_id: school_id || undefined,
          status: 'ACTIVE',
        },
      }),
      prisma.subscription.aggregate({
        where: {
          school_id: school_id || undefined,
          status: 'ACTIVE',
        },
        _sum: { grand_total: true },
      }),
    ]);

    return {
      totalSchools,
      activeSchools,
      pastDueSchools,
      trialingSchools,
      totalStudents,
      studentsThisMonth,
      activeSubscriptions,
      mrrUsd: (mrrData._sum.grand_total || 0) / 100,
    };
  }

  async getSchoolGrowth(months = 12, schoolId = null) {
    const labels = [];
    const datasets = [];

    for (let i = months - 1; i >= 0; i--) {
      const date = new Date();
      date.setMonth(date.getMonth() - i);
      const startOfMonth = new Date(date.getFullYear(), date.getMonth(), 1);
      const endOfMonth = new Date(date.getFullYear(), date.getMonth() + 1, 0);
      labels.push(startOfMonth.toLocaleString('default', { month: 'short', year: 'numeric' }));

      const count = await prisma.school.count({
        where: {
          ...(schoolId && { id: schoolId }),
          created_at: { lte: endOfMonth },
        },
      });
      datasets.push(count);
    }

    return { labels, datasets: [{ label: 'Total Schools', data: datasets }] };
  }

  async getSubscriptionBreakdown(schoolId = null) {
    const breakdown = await prisma.subscription.groupBy({
      by: ['plan'],
      where: {
        school_id: schoolId || undefined,
        status: 'ACTIVE',
      },
      _count: { id: true },
    });

    const planLabels = {
      FREE_PILOT: 'Free Pilot',
      GOVT_STANDARD: 'Government Standard',
      PRIVATE_STANDARD: 'Private Standard',
      ENTERPRISE: 'Enterprise',
    };

    return breakdown.map(item => ({
      name: planLabels[item.plan] || item.plan,
      value: item._count.id,
    }));
  }

  async getRecentSchools(limit = 10) {
    return prisma.school.findMany({
      take: limit,
      orderBy: { created_at: 'desc' },
      select: {
        id: true,
        name: true,
        code: true,
        city: true,
        state: true,
        school_type: true,
        is_active: true,
        created_at: true,
        subscriptions: {
          take: 1,
          orderBy: { created_at: 'desc' },
          select: { status: true, plan: true },
        },
        _count: {
          select: { students: true, users: true },
        },
      },
    });
  }

  async getRecentAuditLogs(limit = 20, actorType = null) {
    return prisma.auditLog.findMany({
      take: limit,
      orderBy: { created_at: 'desc' },
      where: actorType ? { actor_type: actorType } : {},
      include: {
        school: {
          select: { id: true, name: true, code: true },
        },
      },
    });
  }

  async getSystemHealthSnapshot() {
    const [totalSchools, activeSubscriptions, totalStudents, totalScansToday, anomalyCount] =
      await Promise.all([
        prisma.school.count(),
        prisma.subscription.count({ where: { status: 'ACTIVE' } }),
        prisma.student.count(),
        prisma.scanLog.count({
          where: {
            created_at: { gte: new Date(new Date().setHours(0, 0, 0, 0)) },
          },
        }),
        prisma.scanAnomaly.count({
          where: { resolved: false, severity: { in: ['HIGH', 'CRITICAL'] } },
        }),
      ]);

    return {
      totalSchools,
      activeSubscriptions,
      totalStudents,
      scansToday: totalScansToday,
      unresolvedCriticalAnomalies: anomalyCount,
      systemStatus: 'operational',
    };
  }
}
