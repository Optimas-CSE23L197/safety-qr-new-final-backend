// =============================================================================
// schools.service.js — RESQID Super Admin Schools
// Business logic for school management
// =============================================================================

import { SchoolsRepository } from './schools.repository.js';
import { ApiError } from '#shared/response/ApiError.js';

export class SchoolsService {
  constructor() {
    this.repository = new SchoolsRepository();
  }

  async listSchools(query) {
    const { page, limit, search, city, subscription_status, status, sort_field, sort_dir } = query;
    const skip = (page - 1) * limit;

    const { schools, total } = await this.repository.getSchoolsList(
      { search, city, subscription_status, status },
      { skip, take: limit },
      { sort_field, sort_dir }
    );

    const schoolsWithSubscription = schools.map(school => ({
      id: school.id,
      name: school.name,
      code: school.code,
      city: school.city,
      state: school.state,
      is_active: school.is_active,
      created_at: school.created_at,
      students: school._count.students,
      admins: school._count.users,
      subscription_status: school.subscriptions[0]?.status || null,
      subscription_plan: school.subscriptions[0]?.plan || null,
    }));

    return {
      data: schoolsWithSubscription,
      meta: {
        total,
        page,
        limit,
        totalPages: Math.ceil(total / limit),
      },
    };
  }

  async getSchoolById(id) {
    const school = await this.repository.getSchoolById(id);
    if (!school) {
      throw ApiError.notFound('School');
    }
    return school;
  }

  async toggleSchoolStatus(id, isActive) {
    const school = await this.repository.getSchoolById(id);
    if (!school) {
      throw ApiError.notFound('School');
    }
    return this.repository.toggleSchoolStatus(id, isActive);
  }

  async getStats() {
    return this.repository.getSchoolsStats();
  }

  async getCities() {
    return this.repository.getUniqueCities();
  }

  async registerSchool(payload, superAdminId) {
    const existingSchool = await this.repository.findSchoolByEmail(payload.school.email);
    if (existingSchool) throw ApiError.conflict('School with this email already exists');

    const existingAdmin = await this.repository.findUserByEmail(payload.admin.email);
    if (existingAdmin) throw ApiError.conflict('Admin email already registered');

    return this.repository.createSchoolWithAdmin({
      school: payload.school,
      admin: { ...payload.admin, created_by: superAdminId },
      subscription: payload.subscription,
      agreement: payload.agreement,
    });
  }
}
