// =============================================================================
// students.repository.js — RESQID Super Admin Students
// Database operations for student management
// =============================================================================

import { prisma } from '#config/prisma.js';

export class StudentsRepository {
  async getStudentsList(filters, pagination, sorting) {
    const { search, school_id, status, token_status, print_status, class: classFilter } = filters;
    const { skip, take } = pagination;
    const { sort_field, sort_dir } = sorting;

    const where = {};

    if (search) {
      where.OR = [
        { first_name: { contains: search, mode: 'insensitive' } },
        { last_name: { contains: search, mode: 'insensitive' } },
        { id: { contains: search, mode: 'insensitive' } },
        { admission_number: { contains: search, mode: 'insensitive' } },
        { card_number: { contains: search, mode: 'insensitive' } },
        { token: { contains: search, mode: 'insensitive' } },
        { school: { name: { contains: search, mode: 'insensitive' } } },
      ];
    }

    if (school_id) {
      where.school_id = school_id;
    }

    if (status === 'ACTIVE') {
      where.is_active = true;
    } else if (status === 'INACTIVE') {
      where.is_active = false;
    }

    if (token_status) {
      where.token_status = token_status;
    }

    if (print_status) {
      where.card_print_status = print_status;
    }

    if (classFilter) {
      where.class = classFilter;
    }

    const orderBy = {};
    if (sort_field === 'first_name') orderBy.first_name = sort_dir;
    else if (sort_field === 'last_name') orderBy.last_name = sort_dir;
    else if (sort_field === 'class') orderBy.class = sort_dir;
    else orderBy.created_at = sort_dir;

    const students = await prisma.student.findMany({
      where,
      skip,
      take,
      orderBy,
      select: {
        id: true,
        first_name: true,
        last_name: true,
        class: true,
        section: true,
        is_active: true,
        created_at: true,
        deleted_at: true,
        photo_url: true,
        admission_number: true,
        card_number: true,
        token: true,
        token_status: true,
        card_print_status: true,
        school: {
          select: {
            id: true,
            name: true,
            code: true,
          },
        },
        emergency: {
          select: {
            blood_group: true,
            allergies: true,
          },
        },
      },
    });

    const total = await prisma.student.count({ where });

    return { students, total };
  }

  async getStudentById(id) {
    return prisma.student.findUnique({
      where: { id },
      select: {
        id: true,
        first_name: true,
        last_name: true,
        class: true,
        section: true,
        is_active: true,
        created_at: true,
        deleted_at: true,
        photo_url: true,
        admission_number: true,
        card_number: true,
        token: true,
        token_status: true,
        token_hash: true,
        card_print_status: true,
        school: {
          select: {
            id: true,
            name: true,
            code: true,
            city: true,
            state: true,
          },
        },
        emergency: {
          select: {
            blood_group: true,
            allergies: true,
            conditions: true,
            medications: true,
            doctor_name: true,
            notes: true,
            contacts: {
              select: {
                name: true,
                relationship: true,
                priority: true,
              },
            },
          },
        },
        cards: {
          select: {
            id: true,
            card_number: true,
            print_status: true,
            printed_at: true,
          },
        },
      },
    });
  }

  async toggleStudentStatus(id, isActive) {
    return prisma.student.update({
      where: { id },
      data: { is_active: isActive },
      select: { id: true, first_name: true, last_name: true, is_active: true },
    });
  }

  async revokeStudentToken(id) {
    return prisma.student.update({
      where: { id },
      data: {
        token_status: 'REVOKED',
        token: null,
        token_hash: null,
      },
      select: { id: true, token_status: true },
    });
  }

  async resetStudentToken(id) {
    const newToken = `TOK_${Date.now()}_${Math.random().toString(36).substring(2, 10).toUpperCase()}`;
    return prisma.student.update({
      where: { id },
      data: {
        token_status: 'UNASSIGNED',
        token: newToken,
        token_hash: null,
      },
      select: { id: true, token_status: true, token: true },
    });
  }

  async markCardReprint(id) {
    return prisma.student.update({
      where: { id },
      data: {
        card_print_status: 'REPRINTED',
      },
      select: { id: true, card_print_status: true },
    });
  }

  async getStudentsStats() {
    const [total, active, inactive, tokenActive, tokenRevoked, cardPrinted] = await Promise.all([
      prisma.student.count(),
      prisma.student.count({ where: { is_active: true } }),
      prisma.student.count({ where: { is_active: false } }),
      prisma.student.count({ where: { token_status: 'ACTIVE' } }),
      prisma.student.count({ where: { token_status: 'REVOKED' } }),
      prisma.student.count({
        where: {
          card_print_status: { in: ['PRINTED', 'REPRINTED'] },
        },
      }),
    ]);

    return {
      total,
      active,
      inactive,
      tokenActive,
      tokenRevoked,
      cardPrinted,
    };
  }

  async getUniqueSchools() {
    const schools = await prisma.school.findMany({
      select: { id: true, name: true, code: true },
      orderBy: { name: 'asc' },
    });
    return schools;
  }

  async getUniqueClasses() {
    const classes = await prisma.student.findMany({
      where: { class: { not: null } },
      distinct: ['class'],
      select: { class: true },
      orderBy: { class: 'asc' },
    });
    return classes.map(c => c.class).filter(Boolean);
  }

  async getTokenStatuses() {
    return ['UNASSIGNED', 'ISSUED', 'ACTIVE', 'INACTIVE', 'REVOKED', 'EXPIRED'];
  }

  async getPrintStatuses() {
    return ['PENDING', 'PRINTED', 'REPRINTED', 'FAILED'];
  }
}
