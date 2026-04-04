// =============================================================================
// students.service.js — RESQID Super Admin Students
// Business logic for student management
// =============================================================================

import { StudentsRepository } from './students.repository.js';
import { ApiError } from '#shared/response/ApiError.js';

export class StudentsService {
  constructor() {
    this.repository = new StudentsRepository();
  }

  async listStudents(query) {
    const {
      page,
      limit,
      search,
      school_id,
      status,
      token_status,
      print_status,
      class: classFilter,
      sort_field,
      sort_dir,
    } = query;
    const skip = (page - 1) * limit;

    const { students, total } = await this.repository.getStudentsList(
      { search, school_id, status, token_status, print_status, class: classFilter },
      { skip, take: limit },
      { sort_field, sort_dir }
    );

    return {
      data: students,
      meta: {
        total,
        page,
        limit,
        totalPages: Math.ceil(total / limit),
      },
    };
  }

  async getStudentById(id) {
    const student = await this.repository.getStudentById(id);
    if (!student) {
      throw ApiError.notFound('Student');
    }
    return student;
  }

  async toggleStudentStatus(id, isActive) {
    const student = await this.repository.getStudentById(id);
    if (!student) {
      throw ApiError.notFound('Student');
    }
    return this.repository.toggleStudentStatus(id, isActive);
  }

  async revokeToken(id) {
    const student = await this.repository.getStudentById(id);
    if (!student) {
      throw ApiError.notFound('Student');
    }
    if (student.token_status === 'REVOKED') {
      throw ApiError.badRequest('Token is already revoked');
    }
    if (student.token_status === 'UNASSIGNED') {
      throw ApiError.badRequest('Cannot revoke an unassigned token');
    }
    return this.repository.revokeStudentToken(id);
  }

  async resetToken(id) {
    const student = await this.repository.getStudentById(id);
    if (!student) {
      throw ApiError.notFound('Student');
    }
    return this.repository.resetStudentToken(id);
  }

  async markCardReprint(id) {
    const student = await this.repository.getStudentById(id);
    if (!student) {
      throw ApiError.notFound('Student');
    }
    return this.repository.markCardReprint(id);
  }

  async getStats() {
    return this.repository.getStudentsStats();
  }

  async getFilters() {
    const [schools, classes, tokenStatuses, printStatuses] = await Promise.all([
      this.repository.getUniqueSchools(),
      this.repository.getUniqueClasses(),
      this.repository.getTokenStatuses(),
      this.repository.getPrintStatuses(),
    ]);

    return {
      schools,
      classes,
      tokenStatuses,
      printStatuses,
    };
  }
}
