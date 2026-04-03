// =============================================================================
// admins.repository.js — RESQID Super Admin Admin Management
// Database operations for admin management (SuperAdmin + SchoolUser)
// =============================================================================

import { prisma } from '#config/prisma.js';

export class AdminsRepository {
  async getAllAdmins(filters, pagination, sorting) {
    const { search, role, status } = filters;
    const { skip, take } = pagination;
    const { sort_field, sort_dir } = sorting;

    const orderBy = { [sort_field]: sort_dir };

    // Fetch Super Admins
    const superAdminWhere = {};
    if (search) {
      superAdminWhere.OR = [
        { name: { contains: search, mode: 'insensitive' } },
        { email: { contains: search, mode: 'insensitive' } },
      ];
    }
    if (status === 'active') superAdminWhere.is_active = true;
    if (status === 'inactive') superAdminWhere.is_active = false;

    const superAdmins = await prisma.superAdmin.findMany({
      where: superAdminWhere,
      select: {
        id: true,
        name: true,
        email: true,
        is_active: true,
        last_login_at: true,
        created_at: true,
      },
    });

    const mappedSuperAdmins = superAdmins.map(admin => ({
      ...admin,
      role: 'SUPER_ADMIN',
      school_name: null,
      school_id: null,
    }));

    // Fetch School Admins (role = ADMIN)
    const schoolAdminWhere = {
      role: 'ADMIN',
    };
    if (search) {
      schoolAdminWhere.OR = [
        { name: { contains: search, mode: 'insensitive' } },
        { email: { contains: search, mode: 'insensitive' } },
        { school: { name: { contains: search, mode: 'insensitive' } } },
      ];
    }
    if (status === 'active') schoolAdminWhere.is_active = true;
    if (status === 'inactive') schoolAdminWhere.is_active = false;

    const schoolAdmins = await prisma.schoolUser.findMany({
      where: schoolAdminWhere,
      select: {
        id: true,
        name: true,
        email: true,
        is_active: true,
        last_login_at: true,
        created_at: true,
        school: {
          select: {
            id: true,
            name: true,
          },
        },
      },
    });

    const mappedSchoolAdmins = schoolAdmins.map(admin => ({
      id: admin.id,
      name: admin.name,
      email: admin.email,
      is_active: admin.is_active,
      last_login_at: admin.last_login_at,
      created_at: admin.created_at,
      role: 'ADMIN',
      school_name: admin.school?.name || null,
      school_id: admin.school?.id || null,
    }));

    let allAdmins = [...mappedSuperAdmins, ...mappedSchoolAdmins];

    // Apply role filter
    if (role) {
      allAdmins = allAdmins.filter(admin => admin.role === role);
    }

    // Apply sorting
    allAdmins.sort((a, b) => {
      let aVal = a[sort_field];
      let bVal = b[sort_field];
      if (sort_field === 'last_login_at') {
        aVal = aVal || null;
        bVal = bVal || null;
      }
      if (aVal === null) return sort_dir === 'asc' ? 1 : -1;
      if (bVal === null) return sort_dir === 'asc' ? -1 : 1;
      if (typeof aVal === 'string') {
        const comparison = aVal.localeCompare(bVal);
        return sort_dir === 'asc' ? comparison : -comparison;
      }
      return sort_dir === 'asc' ? aVal - bVal : bVal - aVal;
    });

    const total = allAdmins.length;
    const admins = allAdmins.slice(skip, skip + take);

    return { admins, total };
  }

  async getAdminById(id, role) {
    if (role === 'SUPER_ADMIN') {
      return prisma.superAdmin.findUnique({
        where: { id },
        select: {
          id: true,
          name: true,
          email: true,
          is_active: true,
          last_login_at: true,
          created_at: true,
        },
      });
    }
    return prisma.schoolUser.findUnique({
      where: { id },
      select: {
        id: true,
        name: true,
        email: true,
        is_active: true,
        last_login_at: true,
        created_at: true,
        school: {
          select: {
            id: true,
            name: true,
          },
        },
      },
    });
  }

  async toggleSuperAdminStatus(id, isActive) {
    return prisma.superAdmin.update({
      where: { id },
      data: { is_active: isActive },
      select: { id: true, name: true, email: true, is_active: true },
    });
  }

  async toggleSchoolAdminStatus(id, isActive) {
    return prisma.schoolUser.update({
      where: { id },
      data: { is_active: isActive },
      select: { id: true, name: true, email: true, is_active: true },
    });
  }

  async getAdminsStats() {
    const [superAdminsTotal, superAdminsActive, schoolAdminsTotal, schoolAdminsActive] =
      await Promise.all([
        prisma.superAdmin.count(),
        prisma.superAdmin.count({ where: { is_active: true } }),
        prisma.schoolUser.count({ where: { role: 'ADMIN' } }),
        prisma.schoolUser.count({ where: { role: 'ADMIN', is_active: true } }),
      ]);

    return {
      total: superAdminsTotal + schoolAdminsTotal,
      active: superAdminsActive + schoolAdminsActive,
      inactive: superAdminsTotal + schoolAdminsTotal - (superAdminsActive + schoolAdminsActive),
      super_admins: { total: superAdminsTotal, active: superAdminsActive },
      school_admins: { total: schoolAdminsTotal, active: schoolAdminsActive },
    };
  }

  async getSuperAdminByEmail(email) {
    return prisma.superAdmin.findUnique({ where: { email } });
  }

  async getSchoolAdminByEmail(email) {
    return prisma.schoolUser.findUnique({ where: { email } });
  }
}
