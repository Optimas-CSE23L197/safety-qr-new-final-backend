// =============================================================================
// scan-logs.repository.js — RESQID Super Admin Scan Logs
// Database operations for scan log management
// =============================================================================

import { prisma } from '#config/prisma.js';

export class ScanLogsRepository {
  async getScanLogsList(filters, pagination, sorting) {
    const { search, school_id, result, scan_type, scan_purpose, from_date, to_date } = filters;
    const { skip, take } = pagination;
    const { sort_field, sort_dir } = sorting;

    const where = {};

    if (school_id) {
      where.school_id = school_id;
    }

    if (result) {
      where.result = result;
    }

    if (scan_type) {
      where.scan_type = scan_type;
    }

    if (scan_purpose) {
      where.scan_purpose = scan_purpose;
    }

    if (from_date || to_date) {
      where.created_at = {};
      if (from_date) where.created_at.gte = new Date(from_date);
      if (to_date) where.created_at.lte = new Date(to_date);
    }

    if (search) {
      where.OR = [
        { ip_address: { contains: search, mode: 'insensitive' } },
        { device_hash: { contains: search, mode: 'insensitive' } },
        { user_agent: { contains: search, mode: 'insensitive' } },
        { student: { first_name: { contains: search, mode: 'insensitive' } } },
        { student: { last_name: { contains: search, mode: 'insensitive' } } },
        { school: { name: { contains: search, mode: 'insensitive' } } },
        { token: { token_hash: { contains: search, mode: 'insensitive' } } },
      ];
    }

    const orderBy = {};
    if (sort_field === 'response_time_ms') orderBy.response_time_ms = sort_dir;
    else orderBy.created_at = sort_dir;

    const scanLogs = await prisma.scanLog.findMany({
      where,
      skip,
      take,
      orderBy,
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
        token: {
          select: {
            id: true,
            token_hash: true,
            status: true,
          },
        },
      },
    });

    const total = await prisma.scanLog.count({ where });

    const formattedLogs = scanLogs.map(log => ({
      id: log.id,
      student: log.student
        ? `${log.student.first_name} ${log.student.last_name || ''}`.trim()
        : 'Unassigned Token',
      student_id: log.student?.id,
      school: log.school?.name || 'Unknown',
      school_id: log.school_id,
      scan_type: log.scan_type,
      scan_purpose: log.scan_purpose,
      location:
        [log.ip_city, log.ip_region, log.ip_country].filter(Boolean).join(', ') || 'Unknown',
      latitude: log.latitude,
      longitude: log.longitude,
      device: log.user_agent?.split(' ')[0] || 'Unknown',
      device_hash: log.device_hash,
      ip_address: log.ip_address,
      result: log.result,
      response_time_ms: log.response_time_ms,
      created_at: log.created_at,
      emergency_dispatched: log.emergency_dispatched,
      metadata: {
        token_prefix: log.token?.token_hash?.slice(0, 8),
        scan_purpose: log.scan_purpose,
        location_derived: log.location_derived,
        ip_capture_basis: log.ip_capture_basis,
        ...(log.scan_type === 'EMERGENCY' && { emergency_dispatched: log.emergency_dispatched }),
      },
    }));

    return { scanLogs: formattedLogs, total };
  }

  async getScanLogById(id) {
    const scanLog = await prisma.scanLog.findUnique({
      where: { id },
      include: {
        student: {
          select: {
            id: true,
            first_name: true,
            last_name: true,
            class: true,
            section: true,
            school_id: true,
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
        token: {
          select: {
            id: true,
            token_hash: true,
            status: true,
            is_honeypot: true,
          },
        },
      },
    });

    if (!scanLog) return null;

    return {
      id: scanLog.id,
      token_id: scanLog.token_id,
      token_hash: scanLog.token?.token_hash,
      token_status: scanLog.token?.status,
      is_honeypot: scanLog.token?.is_honeypot,
      student: scanLog.student
        ? `${scanLog.student.first_name} ${scanLog.student.last_name || ''}`.trim()
        : null,
      student_id: scanLog.student?.id,
      school: scanLog.school,
      scan_type: scanLog.scan_type,
      scan_purpose: scanLog.scan_purpose,
      result: scanLog.result,
      ip_address: scanLog.ip_address,
      ip_city: scanLog.ip_city,
      ip_country: scanLog.ip_country,
      ip_region: scanLog.ip_region,
      latitude: scanLog.latitude,
      longitude: scanLog.longitude,
      location_derived: scanLog.location_derived,
      device_hash: scanLog.device_hash,
      user_agent: scanLog.user_agent,
      response_time_ms: scanLog.response_time_ms,
      created_at: scanLog.created_at,
      scanned_at: scanLog.scanned_at,
      scanned_by: scanLog.scanned_by,
      emergency_dispatched: scanLog.emergency_dispatched,
      dispatched_at: scanLog.dispatched_at,
      dispatched_channels: scanLog.dispatched_channels,
      failed_channels: scanLog.failed_channels,
      ip_capture_basis: scanLog.ip_capture_basis,
    };
  }

  async getScanLogsStats(filters = {}) {
    const { from_date, to_date } = filters;

    const dateFilter = {};
    if (from_date || to_date) {
      dateFilter.created_at = {};
      if (from_date) dateFilter.created_at.gte = new Date(from_date);
      if (to_date) dateFilter.created_at.lte = new Date(to_date);
    }

    const where = { ...dateFilter };

    const [total, success, failed, anomaly, rateLimited, malicious, emergency, avgResponseTime] =
      await Promise.all([
        prisma.scanLog.count({ where }),
        prisma.scanLog.count({ where: { ...where, result: 'SUCCESS' } }),
        prisma.scanLog.count({ where: { ...where, result: 'INVALID' } }),
        prisma.scanLog.count({ where: { ...where, result: 'ERROR' } }),
        prisma.scanLog.count({ where: { ...where, result: 'RATE_LIMITED' } }),
        prisma.scanLog.count({ where: { ...where, result: 'REVOKED' } }),
        prisma.scanLog.count({ where: { ...where, scan_type: 'EMERGENCY' } }),
        prisma.scanLog.aggregate({
          where,
          _avg: { response_time_ms: true },
        }),
      ]);

    const successRate = total > 0 ? (success / total) * 100 : 0;

    return {
      total,
      success,
      failed,
      anomaly,
      rateLimited,
      malicious,
      emergency,
      successRate: Math.round(successRate * 10) / 10,
      avgResponseTimeMs: Math.round(scanLogsAggregate._avg.response_time_ms || 0),
    };
  }

  async getUniqueSchools() {
    const schools = await prisma.school.findMany({
      select: { id: true, name: true, code: true },
      orderBy: { name: 'asc' },
    });
    return schools;
  }

  async getUniqueScanResults() {
    return [
      'SUCCESS',
      'INVALID',
      'REVOKED',
      'EXPIRED',
      'INACTIVE',
      'UNREGISTERED',
      'ISSUED',
      'RATE_LIMITED',
      'ERROR',
    ];
  }

  async getUniqueScanTypes() {
    return ['EMERGENCY', 'CHECK_IN', 'ATTENDANCE', 'OTHER'];
  }

  async getUniqueScanPurposes() {
    return ['QR_SCAN', 'MANUAL_LOOKUP', 'HONEYPOT'];
  }
}
