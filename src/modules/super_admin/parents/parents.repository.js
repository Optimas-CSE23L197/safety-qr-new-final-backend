// =============================================================================
// parents.repository.js — RESQID Super Admin Parents
// Database operations for parent management
// =============================================================================

import { prisma } from '#config/prisma.js';

export class ParentsRepository {
  async getParentsList(filters, pagination, sorting) {
    const { search, status, phone_verified, email_verified, platform } = filters;
    const { skip, take } = pagination;
    const { sort_field, sort_dir } = sorting;

    const where = {};

    if (search) {
      where.OR = [
        { name: { contains: search, mode: 'insensitive' } },
        { phone: { contains: search } },
        { email: { contains: search, mode: 'insensitive' } },
        { id: { contains: search, mode: 'insensitive' } },
      ];
    }

    if (status) {
      where.status = status;
    }

    if (phone_verified === 'YES') {
      where.is_phone_verified = true;
    } else if (phone_verified === 'NO') {
      where.is_phone_verified = false;
    }

    if (email_verified === 'YES') {
      where.is_email_verified = true;
    } else if (email_verified === 'NO') {
      where.is_email_verified = false;
    }

    const orderBy = {};
    if (sort_field === 'name') orderBy.name = sort_dir;
    else if (sort_field === 'phone') orderBy.phone = sort_dir;
    else if (sort_field === 'last_login_at') orderBy.last_login_at = sort_dir;
    else orderBy.created_at = sort_dir;

    let parents = await prisma.parentUser.findMany({
      where,
      skip,
      take,
      orderBy,
      include: {
        devices: {
          where: platform ? { platform: platform } : undefined,
          select: {
            id: true,
            platform: true,
            device_name: true,
            app_version: true,
            is_active: true,
            last_seen_at: true,
            device_token: true,
          },
        },
        children: {
          include: {
            student: {
              select: {
                id: true,
                first_name: true,
                last_name: true,
                class: true,
                section: true,
                school: {
                  select: {
                    id: true,
                    name: true,
                    code: true,
                  },
                },
              },
            },
          },
        },
      },
    });

    // Apply platform filter at parent level (must have at least one device with platform)
    if (platform) {
      parents = parents.filter(parent =>
        parent.devices.some(device => device.platform === platform)
      );
    }

    const total = await prisma.parentUser.count({ where });

    const formattedParents = parents.map(parent => ({
      id: parent.id,
      name: parent.name,
      phone: parent.phone,
      phone_index: parent.phone_index,
      email: parent.email,
      is_phone_verified: parent.is_phone_verified,
      is_email_verified: parent.is_email_verified,
      status: parent.status,
      created_at: parent.created_at,
      last_login_at: parent.last_login_at,
      deleted_at: parent.deleted_at,
      devices: parent.devices,
      children: parent.children.map(child => ({
        student_id: child.student_id,
        student_name: child.student
          ? `${child.student.first_name} ${child.student.last_name || ''}`.trim()
          : 'Unknown',
        class: child.student?.class,
        section: child.student?.section,
        relationship: child.relationship,
        is_primary: child.is_primary,
        school: child.student?.school,
      })),
    }));

    return { parents: formattedParents, total };
  }

  async getParentById(id) {
    const parent = await prisma.parentUser.findUnique({
      where: { id },
      include: {
        devices: {
          orderBy: { last_seen_at: 'desc' },
        },
        children: {
          include: {
            student: {
              include: {
                school: {
                  select: {
                    id: true,
                    name: true,
                    code: true,
                  },
                },
              },
            },
          },
        },
        notificationPrefs: true,
      },
    });

    if (!parent) return null;

    return {
      id: parent.id,
      name: parent.name,
      phone: parent.phone,
      phone_index: parent.phone_index,
      email: parent.email,
      is_phone_verified: parent.is_phone_verified,
      is_email_verified: parent.is_email_verified,
      status: parent.status,
      created_at: parent.created_at,
      last_login_at: parent.last_login_at,
      deleted_at: parent.deleted_at,
      devices: parent.devices,
      children: parent.children.map(child => ({
        student_id: child.student_id,
        student_name: child.student
          ? `${child.student.first_name} ${child.student.last_name || ''}`.trim()
          : 'Unknown',
        class: child.student?.class,
        section: child.student?.section,
        relationship: child.relationship,
        is_primary: child.is_primary,
        school: child.student?.school,
      })),
      notification_prefs: parent.notificationPrefs,
    };
  }

  async updateParentStatus(id, status) {
    const data = { status };
    if (status === 'DELETED') {
      data.deleted_at = new Date();
    } else if (status === 'ACTIVE') {
      data.deleted_at = null;
    }
    return prisma.parentUser.update({
      where: { id },
      data,
      select: { id: true, name: true, status: true },
    });
  }

  async revokeAllDevices(id) {
    return prisma.parentDevice.updateMany({
      where: { parent_id: id, is_active: true },
      data: {
        is_active: false,
        logged_out_at: new Date(),
        logout_reason: 'ADMIN_REVOKED',
      },
    });
  }

  async getParentsStats() {
    const [total, active, suspended, deleted, phoneVerified, emailVerified, activeDevices] =
      await Promise.all([
        prisma.parentUser.count(),
        prisma.parentUser.count({ where: { status: 'ACTIVE' } }),
        prisma.parentUser.count({ where: { status: 'SUSPENDED' } }),
        prisma.parentUser.count({ where: { status: 'DELETED' } }),
        prisma.parentUser.count({ where: { is_phone_verified: true } }),
        prisma.parentUser.count({ where: { is_email_verified: true } }),
        prisma.parentDevice.count({ where: { is_active: true } }),
      ]);

    return {
      total,
      active,
      suspended,
      deleted,
      phoneVerified,
      emailVerified,
      activeDevices,
    };
  }

  async getUniquePlatforms() {
    const platforms = await prisma.parentDevice.findMany({
      where: { platform: { not: null } },
      distinct: ['platform'],
      select: { platform: true },
    });
    return platforms.map(p => p.platform).filter(Boolean);
  }
}
