// =============================================================================
// scan-anomalies.repository.js — RESQID Super Admin Scan Anomalies
// Database operations for scan anomaly management
// =============================================================================

import { prisma } from '#config/prisma.js';

export class ScanAnomaliesRepository {
  async getAnomaliesList(filters, pagination, sorting) {
    const { search, resolved, anomaly_type, severity, from_date, to_date } = filters;
    const { skip, take } = pagination;
    const { sort_field, sort_dir } = sorting;

    const where = {};

    if (anomaly_type) {
      where.anomaly_type = anomaly_type;
    }

    if (severity) {
      where.severity = severity;
    }

    if (resolved === 'RESOLVED') {
      where.resolved = true;
    } else if (resolved === 'UNRESOLVED') {
      where.resolved = false;
    }

    if (from_date || to_date) {
      where.created_at = {};
      if (from_date) where.created_at.gte = new Date(from_date);
      if (to_date) where.created_at.lte = new Date(to_date);
    }

    const orderBy = {};
    if (sort_field === 'severity') {
      orderBy.severity = sort_dir;
    } else if (sort_field === 'anomaly_type') {
      orderBy.anomaly_type = sort_dir;
    } else {
      orderBy.created_at = sort_dir;
    }

    const anomalies = await prisma.scanAnomaly.findMany({
      where,
      skip,
      take,
      orderBy,
      include: {
        token: {
          include: {
            student: {
              select: {
                id: true,
                first_name: true,
                last_name: true,
                class: true,
                section: true,
              },
            },
            school: {
              select: {
                id: true,
                name: true,
                code: true,
              },
            },
          },
        },
      },
    });

    const total = await prisma.scanAnomaly.count({ where });

    // Apply search filter (can't be done in Prisma where due to relations)
    let filteredAnomalies = anomalies;
    if (search) {
      const lq = search.toLowerCase();
      filteredAnomalies = anomalies.filter(a => {
        const studentName = a.token?.student
          ? `${a.token.student.first_name} ${a.token.student.last_name || ''}`.toLowerCase()
          : '';
        const schoolName = a.token?.school?.name?.toLowerCase() || '';
        const tokenHash = a.token?.token_hash?.toLowerCase() || '';
        const anomalyId = a.id.toLowerCase();
        const reason = a.reason?.toLowerCase() || '';
        return (
          anomalyId.includes(lq) ||
          studentName.includes(lq) ||
          schoolName.includes(lq) ||
          tokenHash.includes(lq) ||
          reason.includes(lq)
        );
      });
    }

    const formattedAnomalies = filteredAnomalies.map(anomaly => ({
      id: anomaly.id,
      token: anomaly.token?.token_hash?.slice(0, 20) + '...' || 'Unknown',
      token_id: anomaly.token_id,
      student: anomaly.token?.student
        ? `${anomaly.token.student.first_name} ${anomaly.token.student.last_name || ''}`.trim()
        : 'Unknown',
      student_id: anomaly.token?.student?.id,
      school: anomaly.token?.school?.name || 'Unknown',
      school_id: anomaly.token?.school?.id,
      anomaly_type: anomaly.anomaly_type,
      severity: anomaly.severity,
      reason: anomaly.reason,
      resolved: anomaly.resolved,
      resolved_at: anomaly.resolved_at,
      resolved_by: anomaly.resolved_by,
      created_at: anomaly.created_at,
      metadata: anomaly.metadata,
    }));

    const finalTotal = filteredAnomalies.length;

    return { anomalies: formattedAnomalies, total: finalTotal };
  }

  async getAnomalyById(id) {
    const anomaly = await prisma.scanAnomaly.findUnique({
      where: { id },
      include: {
        token: {
          include: {
            student: {
              select: {
                id: true,
                first_name: true,
                last_name: true,
                class: true,
                section: true,
                admission_number: true,
              },
            },
            school: {
              select: {
                id: true,
                name: true,
                code: true,
                city: true,
                state: true,
              },
            },
          },
        },
      },
    });

    if (!anomaly) return null;

    return {
      id: anomaly.id,
      token_id: anomaly.token_id,
      token_hash: anomaly.token?.token_hash,
      student: anomaly.token?.student
        ? `${anomaly.token.student.first_name} ${anomaly.token.student.last_name || ''}`.trim()
        : null,
      student_id: anomaly.token?.student?.id,
      school: anomaly.token?.school,
      anomaly_type: anomaly.anomaly_type,
      severity: anomaly.severity,
      reason: anomaly.reason,
      metadata: anomaly.metadata,
      resolved: anomaly.resolved,
      resolved_at: anomaly.resolved_at,
      resolved_by: anomaly.resolved_by,
      created_at: anomaly.created_at,
    };
  }

  async resolveAnomaly(id, resolvedBy = null) {
    return prisma.scanAnomaly.update({
      where: { id },
      data: {
        resolved: true,
        resolved_at: new Date(),
        resolved_by: resolvedBy,
      },
      select: {
        id: true,
        resolved: true,
        resolved_at: true,
        resolved_by: true,
      },
    });
  }

  async getAnomaliesStats(filters = {}) {
    const { from_date, to_date } = filters;

    const dateFilter = {};
    if (from_date || to_date) {
      dateFilter.created_at = {};
      if (from_date) dateFilter.created_at.gte = new Date(from_date);
      if (to_date) dateFilter.created_at.lte = new Date(to_date);
    }

    const where = { ...dateFilter };

    const [total, resolved, unresolved, bySeverity, byType] = await Promise.all([
      prisma.scanAnomaly.count({ where }),
      prisma.scanAnomaly.count({ where: { ...where, resolved: true } }),
      prisma.scanAnomaly.count({ where: { ...where, resolved: false } }),
      prisma.scanAnomaly.groupBy({
        by: ['severity'],
        where,
        _count: { severity: true },
      }),
      prisma.scanAnomaly.groupBy({
        by: ['anomaly_type'],
        where,
        _count: { anomaly_type: true },
      }),
    ]);

    const severityMap = {
      LOW: 0,
      MEDIUM: 0,
      HIGH: 0,
      CRITICAL: 0,
    };
    bySeverity.forEach(s => {
      severityMap[s.severity] = s._count.severity;
    });

    const typeMap = {};
    byType.forEach(t => {
      typeMap[t.anomaly_type] = t._count.anomaly_type;
    });

    return {
      total,
      resolved,
      unresolved,
      by_severity: severityMap,
      by_type: typeMap,
    };
  }

  async getUniqueAnomalyTypes() {
    return [
      'HIGH_FREQUENCY',
      'MULTIPLE_LOCATIONS',
      'SUSPICIOUS_IP',
      'AFTER_HOURS',
      'BULK_SCRAPING',
      'HONEYPOT_TRIGGERED',
      'REPEATED_FAILURE',
    ];
  }

  async getUniqueSeverities() {
    return ['LOW', 'MEDIUM', 'HIGH', 'CRITICAL'];
  }
}
