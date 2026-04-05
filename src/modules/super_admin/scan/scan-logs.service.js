// =============================================================================
// scan-logs.service.js — RESQID Super Admin Scan Logs
// Business logic for scan log management
// =============================================================================

import { ScanLogsRepository } from './scan-logs.repository.js';
import { ApiError } from '#shared/response/ApiError.js';

export class ScanLogsService {
  constructor() {
    this.repository = new ScanLogsRepository();
  }

  async listScanLogs(query) {
    const {
      page,
      limit,
      search,
      school_id,
      result,
      scan_type,
      scan_purpose,
      from_date,
      to_date,
      sort_field,
      sort_dir,
    } = query;
    const skip = (page - 1) * limit;

    const { scanLogs, total } = await this.repository.getScanLogsList(
      { search, school_id, result, scan_type, scan_purpose, from_date, to_date },
      { skip, take: limit },
      { sort_field, sort_dir }
    );

    return {
      data: scanLogs,
      meta: {
        total,
        page,
        limit,
        totalPages: Math.ceil(total / limit),
      },
    };
  }

  async getScanLogById(id) {
    const scanLog = await this.repository.getScanLogById(id);
    if (!scanLog) {
      throw ApiError.notFound('Scan log');
    }
    return scanLog;
  }

  async getStats(filters = {}) {
    return this.repository.getScanLogsStats(filters);
  }

  async getFilters() {
    const [schools, scanResults, scanTypes, scanPurposes] = await Promise.all([
      this.repository.getUniqueSchools(),
      this.repository.getUniqueScanResults(),
      this.repository.getUniqueScanTypes(),
      this.repository.getUniqueScanPurposes(),
    ]);

    return {
      schools,
      scanResults,
      scanTypes,
      scanPurposes,
    };
  }
}
