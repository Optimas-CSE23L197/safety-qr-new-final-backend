// =============================================================================
// schools.repository.js — RESQID Super Admin Schools
// Database operations for school management
// =============================================================================

import { prisma } from '#config/prisma.js';

export class SchoolsRepository {
  async getSchoolsList(filters, pagination, sorting) {
    const { search, city, subscription_status, status } = filters;
    const { skip, take } = pagination;
    const { sort_field, sort_dir } = sorting;

    const where = {};

    if (search) {
      where.OR = [
        { name: { contains: search, mode: 'insensitive' } },
        { code: { contains: search, mode: 'insensitive' } },
        { city: { contains: search, mode: 'insensitive' } },
      ];
    }

    if (city) {
      where.city = { equals: city, mode: 'insensitive' };
    }

    if (status === 'active') {
      where.is_active = true;
    } else if (status === 'inactive') {
      where.is_active = false;
    }

    const orderBy = {};
    if (sort_field === 'students') {
      // Will handle in JS due to aggregation
      orderBy.created_at = sort_dir;
    } else {
      orderBy[sort_field] = sort_dir;
    }

    const schools = await prisma.school.findMany({
      where,
      skip,
      take,
      orderBy: sort_field === 'students' ? { created_at: sort_dir } : orderBy,
      select: {
        id: true,
        name: true,
        code: true,
        city: true,
        state: true,
        is_active: true,
        created_at: true,
        _count: {
          select: {
            students: true,
            users: {
              where: { role: 'ADMIN' },
            },
          },
        },
        subscriptions: {
          where: { status: { not: 'CANCELED' } },
          orderBy: { created_at: 'desc' },
          take: 1,
          select: { status: true, plan: true },
        },
      },
    });

    let filteredSchools = schools;

    if (subscription_status) {
      filteredSchools = schools.filter(
        school => school.subscriptions[0]?.status === subscription_status
      );
    }

    if (sort_field === 'students') {
      filteredSchools.sort((a, b) => {
        const aCount = a._count.students;
        const bCount = b._count.students;
        return sort_dir === 'asc' ? aCount - bCount : bCount - aCount;
      });
    }

    const total = await prisma.school.count({ where });

    return { schools: filteredSchools, total };
  }

  async getSchoolById(id) {
    return prisma.school.findUnique({
      where: { id },
      include: {
        _count: {
          select: {
            students: true,
            users: true,
            subscriptions: true,
          },
        },
        subscriptions: {
          orderBy: { created_at: 'desc' },
          take: 1,
          select: { status: true, plan: true, current_period_end: true },
        },
        settings: true,
      },
    });
  }

  async toggleSchoolStatus(id, isActive) {
    return prisma.school.update({
      where: { id },
      data: { is_active: isActive },
      select: { id: true, name: true, is_active: true },
    });
  }

  async getSchoolsStats() {
    const [total, active] = await Promise.all([
      prisma.school.count(),
      prisma.school.count({ where: { is_active: true } }),
    ]);

    return { total, active, inactive: total - active };
  }

  async getUniqueCities() {
    const cities = await prisma.school.findMany({
      where: { city: { not: null } },
      distinct: ['city'],
      select: { city: true },
      orderBy: { city: 'asc' },
    });
    return cities.map(c => c.city).filter(Boolean);
  }
}
