// =============================================================================
// parents.service.js — RESQID Super Admin Parents
// Business logic for parent management
// =============================================================================

import { ParentsRepository } from './parents.repository.js';
import { ApiError } from '#shared/response/ApiError.js';

export class ParentsService {
  constructor() {
    this.repository = new ParentsRepository();
  }

  async listParents(query) {
    const {
      page,
      limit,
      search,
      status,
      phone_verified,
      email_verified,
      platform,
      sort_field,
      sort_dir,
    } = query;
    const skip = (page - 1) * limit;

    const { parents, total } = await this.repository.getParentsList(
      { search, status, phone_verified, email_verified, platform },
      { skip, take: limit },
      { sort_field, sort_dir }
    );

    return {
      data: parents,
      meta: {
        total,
        page,
        limit,
        totalPages: Math.ceil(total / limit),
      },
    };
  }

  async getParentById(id) {
    const parent = await this.repository.getParentById(id);
    if (!parent) {
      throw ApiError.notFound('Parent');
    }
    return parent;
  }

  async updateParentStatus(id, status) {
    const parent = await this.repository.getParentById(id);
    if (!parent) {
      throw ApiError.notFound('Parent');
    }
    if (parent.status === 'DELETED') {
      throw ApiError.badRequest('Cannot update status of a deleted parent');
    }
    if (parent.status === status) {
      throw ApiError.badRequest(`Parent is already ${status.toLowerCase()}`);
    }
    return this.repository.updateParentStatus(id, status);
  }

  async revokeAllDevices(id) {
    const parent = await this.repository.getParentById(id);
    if (!parent) {
      throw ApiError.notFound('Parent');
    }
    const activeDevices = parent.devices.filter(d => d.is_active);
    if (activeDevices.length === 0) {
      throw ApiError.badRequest('No active devices to revoke');
    }
    await this.repository.revokeAllDevices(id);
    return { message: `${activeDevices.length} device(s) revoked successfully` };
  }

  async getStats() {
    return this.repository.getParentsStats();
  }

  async getFilters() {
    const platforms = await this.repository.getUniquePlatforms();
    return {
      platforms,
      statuses: ['ACTIVE', 'SUSPENDED', 'DELETED'],
    };
  }
}
