// =============================================================================
// admins.service.js — RESQID Super Admin Admin Management
// Business logic for admin management
// =============================================================================

import { AdminsRepository } from './admins.repository.js';
import { ApiError } from '#shared/response/ApiError.js';

export class AdminsService {
  constructor() {
    this.repository = new AdminsRepository();
  }

  async listAdmins(query) {
    const { page, limit, search, role, status, sort_field, sort_dir } = query;
    const skip = (page - 1) * limit;

    const { admins, total } = await this.repository.getAllAdmins(
      { search, role, status },
      { skip, take: limit },
      { sort_field, sort_dir }
    );

    return {
      data: admins,
      meta: {
        total,
        page,
        limit,
        totalPages: Math.ceil(total / limit),
      },
    };
  }

  async getAdminById(id, role) {
    const admin = await this.repository.getAdminById(id, role);
    if (!admin) {
      throw ApiError.notFound('Admin');
    }
    return admin;
  }

  async toggleAdminStatus(id, role, isActive) {
    if (role === 'SUPER_ADMIN') {
      const admin = await this.repository.getAdminById(id, 'SUPER_ADMIN');
      if (!admin) throw ApiError.notFound('Super Admin');
      return this.repository.toggleSuperAdminStatus(id, isActive);
    }
    const admin = await this.repository.getAdminById(id, 'ADMIN');
    if (!admin) throw ApiError.notFound('School Admin');
    return this.repository.toggleSchoolAdminStatus(id, isActive);
  }

  async resetAdminPassword(email) {
    if (!email) {
      throw ApiError.badRequest('Email is required');
    }

    const superAdmin = await this.repository.getSuperAdminByEmail(email);
    const schoolAdmin = await this.repository.getSchoolAdminByEmail(email);

    if (!superAdmin && !schoolAdmin) {
      throw ApiError.notFound('Admin with this email not found');
    }

    // Return success without revealing if email exists (security best practice)
    return { message: 'If an account exists with this email, a password reset link will be sent' };
  }

  async getStats() {
    return this.repository.getAdminsStats();
  }
}
