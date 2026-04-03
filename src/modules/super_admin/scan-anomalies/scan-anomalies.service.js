// =============================================================================
// scan-anomalies.service.js — RESQID Super Admin Scan Anomalies
// Business logic for scan anomaly management
// =============================================================================

import { ScanAnomaliesRepository } from './scan-anomalies.repository.js';
import { ApiError } from '#shared/response/ApiError.js';

export class ScanAnomaliesService {
  constructor() {
    this.repository = new ScanAnomaliesRepository();
  }

  async listAnomalies(query) {
    const {
      page,
      limit,
      search,
      resolved,
      anomaly_type,
      severity,
      from_date,
      to_date,
      sort_field,
      sort_dir,
    } = query;
    const skip = (page - 1) * limit;

    let { anomalies, total } = await this.repository.getAnomaliesList(
      { search, resolved, anomaly_type, severity, from_date, to_date },
      { skip, take: limit },
      { sort_field, sort_dir }
    );

    // Recalculate total after search filter is applied in repository
    // The repository already returns filtered total

    return {
      data: anomalies,
      meta: {
        total,
        page,
        limit,
        totalPages: Math.ceil(total / limit),
      },
    };
  }

  async getAnomalyById(id) {
    const anomaly = await this.repository.getAnomalyById(id);
    if (!anomaly) {
      throw ApiError.notFound('Anomaly');
    }
    return anomaly;
  }

  async resolveAnomaly(id, resolvedBy = null) {
    const anomaly = await this.repository.getAnomalyById(id);
    if (!anomaly) {
      throw ApiError.notFound('Anomaly');
    }
    if (anomaly.resolved) {
      throw ApiError.badRequest('Anomaly is already resolved');
    }
    const actor = resolvedBy || 'super_admin';
    return this.repository.resolveAnomaly(id, actor);
  }

  async getStats(filters = {}) {
    return this.repository.getAnomaliesStats(filters);
  }

  async getFilters() {
    const [anomalyTypes, severities] = await Promise.all([
      this.repository.getUniqueAnomalyTypes(),
      this.repository.getUniqueSeverities(),
    ]);

    return {
      anomalyTypes,
      severities,
      resolvedStatuses: ['RESOLVED', 'UNRESOLVED'],
    };
  }
}
