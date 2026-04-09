// =============================================================================
// schools.service.js — RESQID Super Admin Schools
// Business logic for school management
// =============================================================================

import { SchoolsRepository } from './schools.repository.js';
import { ApiError } from '#shared/response/ApiError.js';
import { prisma } from '#config/prisma.js';
import { logger } from '#config/logger.js';

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

    const totalPages = Math.ceil(total / limit);

    return {
      data: schoolsWithSubscription,
      meta: {
        total,
        page,
        limit,
        totalPages,
        hasNextPage: page < totalPages,
        hasPrevPage: page > 1,
      },
    };
  }

  async getSchoolById(id) {
    if (!id) {
      throw ApiError.badRequest('School ID is required');
    }

    const school = await this.repository.getSchoolById(id);
    if (!school) {
      throw ApiError.notFound('School');
    }
    return school;
  }

  async toggleSchoolStatus(id, isActive, adminId) {
    if (!id) {
      throw ApiError.badRequest('School ID is required');
    }

    if (typeof isActive !== 'boolean') {
      throw ApiError.badRequest('is_active must be a boolean');
    }

    const school = await this.repository.getSchoolById(id);
    if (!school) {
      throw ApiError.notFound('School');
    }

    const result = await this.repository.toggleSchoolStatus(id, isActive);

    // Create audit log
    try {
      await prisma.auditLog.create({
        data: {
          school_id: id,
          actor_id: adminId,
          actor_type: 'SUPER_ADMIN',
          action: 'TOGGLE_SCHOOL_STATUS',
          entity: 'School',
          entity_id: id,
          old_value: { is_active: school.is_active },
          new_value: { is_active: isActive },
        },
      });
    } catch (err) {
      logger.warn({ err: err.message }, 'Failed to create audit log');
    }

    return result;
  }

  async getStats() {
    return this.repository.getSchoolsStats();
  }

  async getCities() {
    return this.repository.getUniqueCities();
  }

  async registerSchool(payload, superAdminId) {
    if (!superAdminId) {
      throw ApiError.unauthorized('Super admin ID required');
    }

    // Check idempotency key
    if (payload.idempotencyKey) {
      const existingIdempotent = await prisma.idempotencyKey.findUnique({
        where: { key: payload.idempotencyKey },
      });

      if (existingIdempotent) {
        logger.info(
          { idempotencyKey: payload.idempotencyKey },
          'Duplicate request blocked by idempotency key'
        );
        return existingIdempotent.response;
      }
    }

    const recentExists = await this.repository.checkRecentRegistration(
      payload.school.email,
      payload.admin.email
    );

    if (recentExists) {
      throw ApiError.conflict(
        'Duplicate registration detected. Please wait 30 seconds before trying again.'
      );
    }

    const existingSchool = await this.repository.findSchoolByEmail(payload.school.email);
    if (existingSchool) throw ApiError.conflict('School with this email already exists');

    const existingAdmin = await this.repository.findUserByEmail(payload.admin.email);
    if (existingAdmin) throw ApiError.conflict('Admin email already registered');

    const result = await this.repository.createSchoolWithAdmin({
      school: payload.school,
      admin: { ...payload.admin, created_by: superAdminId },
      subscription: payload.subscription,
      agreement: payload.agreement,
    });

    // Store idempotency key
    if (payload.idempotencyKey) {
      try {
        await prisma.idempotencyKey.create({
          data: {
            key: payload.idempotencyKey,
            resource_type: 'School',
            resource_id: result.school.id,
            status: 'COMPLETED',
            response: result,
            expires_at: new Date(Date.now() + 24 * 60 * 60 * 1000),
          },
        });
      } catch (err) {
        logger.warn(
          { err: err.message, idempotencyKey: payload.idempotencyKey },
          'Failed to store idempotency key'
        );
      }
    }

    // Create audit log for registration
    try {
      await prisma.auditLog.create({
        data: {
          school_id: result.school.id,
          actor_id: superAdminId,
          actor_type: 'SUPER_ADMIN',
          action: 'REGISTER_SCHOOL',
          entity: 'School',
          entity_id: result.school.id,
          new_value: {
            school_name: result.school.name,
            school_email: payload.school.email,
            admin_email: payload.admin.email,
            plan: payload.subscription.plan,
            student_count: payload.subscription.student_count,
          },
        },
      });
    } catch (err) {
      logger.warn({ err: err.message }, 'Failed to create audit log');
    }

    logger.info(
      {
        event: 'school_registered',
        school_id: result.school.id,
        school_name: result.school.name,
        admin_email: payload.admin.email,
        created_by: superAdminId,
        idempotencyKey: payload.idempotencyKey,
      },
      'New school registered'
    );

    return result;
  }
}
