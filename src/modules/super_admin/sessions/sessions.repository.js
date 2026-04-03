// =============================================================================
// sessions.repository.js — RESQID Super Admin Sessions
// Database operations for session management
// =============================================================================

import { prisma } from '#config/prisma.js';

export class SessionsRepository {
  async getSessionsList(filters, pagination, sorting) {
    const { search, user_type, platform, last_active, status } = filters;
    const { skip, take } = pagination;
    const { sort_field, sort_dir } = sorting;

    const where = {
      is_active:
        status === 'ACTIVE'
          ? true
          : status === 'EXPIRED' || status === 'REVOKED'
            ? false
            : undefined,
    };

    if (status === 'REVOKED') {
      where.revoked_at = { not: null };
    } else if (status === 'EXPIRED') {
      where.expires_at = { lt: new Date() };
      where.revoked_at = null;
    } else if (status === 'ACTIVE') {
      where.expires_at = { gte: new Date() };
      where.revoked_at = null;
    }

    if (user_type === 'PARENT') {
      where.parent_user_id = { not: null };
    } else if (user_type === 'SCHOOL') {
      where.school_user_id = { not: null };
    } else if (user_type === 'SUPER_ADMIN') {
      where.admin_user_id = { not: null };
    }

    if (platform) {
      where.device_info = { contains: platform, mode: 'insensitive' };
    }

    if (last_active) {
      const now = new Date();
      let cutoff;
      if (last_active === '1h') cutoff = new Date(now.getTime() - 60 * 60 * 1000);
      else if (last_active === '24h') cutoff = new Date(now.getTime() - 24 * 60 * 60 * 1000);
      else if (last_active === '7d') cutoff = new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000);
      where.last_active_at = { gte: cutoff };
    }

    const orderBy = {};
    if (sort_field === 'last_active_at') orderBy.last_active_at = sort_dir;
    else if (sort_field === 'expires_at') orderBy.expires_at = sort_dir;
    else orderBy.created_at = sort_dir;

    const sessions = await prisma.session.findMany({
      where,
      skip,
      take,
      orderBy,
      include: {
        parentUser: {
          select: {
            id: true,
            name: true,
            email: true,
            phone: true,
          },
        },
        schoolUser: {
          select: {
            id: true,
            name: true,
            email: true,
            school: {
              select: {
                id: true,
                name: true,
                code: true,
              },
            },
          },
        },
        superAdmin: {
          select: {
            id: true,
            name: true,
            email: true,
          },
        },
      },
    });

    const total = await prisma.session.count({ where });

    // Apply search filter post-query
    let filteredSessions = sessions;
    if (search) {
      const lq = search.toLowerCase();
      filteredSessions = sessions.filter(s => {
        const parentName = s.parentUser?.name?.toLowerCase() || '';
        const parentEmail = s.parentUser?.email?.toLowerCase() || '';
        const schoolName = s.schoolUser?.name?.toLowerCase() || '';
        const schoolEmail = s.schoolUser?.email?.toLowerCase() || '';
        const adminName = s.superAdmin?.name?.toLowerCase() || '';
        const adminEmail = s.superAdmin?.email?.toLowerCase() || '';
        const ip = s.ip_address?.toLowerCase() || '';
        return (
          parentName.includes(lq) ||
          parentEmail.includes(lq) ||
          schoolName.includes(lq) ||
          schoolEmail.includes(lq) ||
          adminName.includes(lq) ||
          adminEmail.includes(lq) ||
          ip.includes(lq)
        );
      });
    }

    const formattedSessions = filteredSessions.map(session => {
      let user = null;
      let userType = null;
      if (session.parentUser) {
        user = session.parentUser;
        userType = 'PARENT';
      } else if (session.schoolUser) {
        user = {
          ...session.schoolUser,
          school: session.schoolUser.school,
        };
        userType = 'SCHOOL';
      } else if (session.superAdmin) {
        user = session.superAdmin;
        userType = 'SUPER_ADMIN';
      }

      const isExpired = new Date(session.expires_at) < new Date();
      const isRevoked = session.revoked_at !== null;
      let status = 'ACTIVE';
      if (isRevoked) status = 'REVOKED';
      else if (isExpired) status = 'EXPIRED';
      else if (!session.is_active) status = 'INACTIVE';

      return {
        id: session.id,
        user_type: userType,
        user_id: user?.id,
        user_name: user?.name,
        user_email: user?.email,
        user_phone: user?.phone,
        school: user?.school || null,
        device_info: session.device_info,
        device_id: session.device_id,
        ip_address: session.ip_address,
        user_agent: session.user_agent,
        last_active_at: session.last_active_at,
        created_at: session.created_at,
        expires_at: session.expires_at,
        revoked_at: session.revoked_at,
        revoke_reason: session.revoke_reason,
        status,
      };
    });

    return { sessions: formattedSessions, total: filteredSessions.length };
  }

  async revokeSession(id, reason = null) {
    return prisma.session.update({
      where: { id },
      data: {
        is_active: false,
        revoked_at: new Date(),
        revoke_reason: reason,
      },
      select: {
        id: true,
        is_active: true,
        revoked_at: true,
        revoke_reason: true,
      },
    });
  }

  async revokeAllSessions(reason = null) {
    const result = await prisma.session.updateMany({
      where: {
        is_active: true,
        expires_at: { gte: new Date() },
        revoked_at: null,
      },
      data: {
        is_active: false,
        revoked_at: new Date(),
        revoke_reason: reason || 'REVOKED_BY_SUPER_ADMIN',
      },
    });
    return result.count;
  }

  async getSessionsStats() {
    const now = new Date();
    const twentyFourHoursFromNow = new Date(now.getTime() + 24 * 60 * 60 * 1000);

    const [totalActive, expiringSoon, platformStats] = await Promise.all([
      prisma.session.count({
        where: {
          is_active: true,
          expires_at: { gte: now },
          revoked_at: null,
        },
      }),
      prisma.session.count({
        where: {
          is_active: true,
          expires_at: { lte: twentyFourHoursFromNow, gte: now },
          revoked_at: null,
        },
      }),
      prisma.session.groupBy({
        by: ['device_info'],
        where: {
          is_active: true,
          expires_at: { gte: now },
          revoked_at: null,
          device_info: { not: null },
        },
        _count: { id: true },
      }),
    ]);

    let mostActivePlatform = null;
    let mostActivePlatformCount = 0;
    if (platformStats.length > 0) {
      for (const stat of platformStats) {
        if (stat._count.id > mostActivePlatformCount) {
          mostActivePlatformCount = stat._count.id;
          mostActivePlatform = stat.device_info;
        }
      }
    }

    return {
      total_active: totalActive,
      expiring_soon_24h: expiringSoon,
      most_active_platform: mostActivePlatform
        ? `${mostActivePlatform} (${mostActivePlatformCount} sessions)`
        : 'None',
      most_active_platform_count: mostActivePlatformCount,
    };
  }
}
