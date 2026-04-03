// =============================================================================
// tokens.repository.js — RESQID Super Admin Tokens
// Database operations for token management
// =============================================================================

import { prisma } from '#config/prisma.js';

export class TokensRepository {
  async getTokensList(filters, pagination, sorting) {
    const { search, status, batch_id, school_id } = filters;
    const { skip, take } = pagination;
    const { sort_field, sort_dir } = sorting;

    const where = {};

    if (status) {
      where.status = status;
    }

    if (batch_id) {
      where.batch_id = batch_id;
    }

    if (school_id) {
      where.school_id = school_id;
    }

    if (search) {
      where.OR = [
        { token_hash: { contains: search, mode: 'insensitive' } },
        { student: { first_name: { contains: search, mode: 'insensitive' } } },
        { student: { last_name: { contains: search, mode: 'insensitive' } } },
        { school: { name: { contains: search, mode: 'insensitive' } } },
        { batch: { id: { contains: search, mode: 'insensitive' } } },
      ];
    }

    const orderBy = {};
    if (sort_field === 'expires_at') orderBy.expires_at = sort_dir;
    else if (sort_field === 'status') orderBy.status = sort_dir;
    else orderBy.created_at = sort_dir;

    const tokens = await prisma.token.findMany({
      where,
      skip,
      take,
      orderBy,
      select: {
        id: true,
        token_hash: true,
        status: true,
        created_at: true,
        expires_at: true,
        activated_at: true,
        revoked_at: true,
        is_honeypot: true,
        school: {
          select: {
            id: true,
            name: true,
            code: true,
          },
        },
        student: {
          select: {
            id: true,
            first_name: true,
            last_name: true,
          },
        },
        batch: {
          select: {
            id: true,
            status: true,
          },
        },
      },
    });

    const total = await prisma.token.count({ where });

    const formattedTokens = tokens.map(token => ({
      id: token.id,
      hash: token.token_hash?.slice(0, 12) || 'N/A',
      full_hash: token.token_hash,
      status: token.status,
      created_at: token.created_at,
      expires_at: token.expires_at,
      activated_at: token.activated_at,
      revoked_at: token.revoked_at,
      is_honeypot: token.is_honeypot,
      school: token.school?.name || 'Unknown',
      school_id: token.school?.id,
      student: token.student
        ? `${token.student.first_name} ${token.student.last_name || ''}`.trim()
        : null,
      student_id: token.student?.id,
      batch: token.batch?.id?.slice(0, 8) || '—',
      batch_id: token.batch?.id,
    }));

    return { tokens: formattedTokens, total };
  }

  async getTokenById(id) {
    const token = await prisma.token.findUnique({
      where: { id },
      select: {
        id: true,
        token_hash: true,
        status: true,
        created_at: true,
        expires_at: true,
        activated_at: true,
        revoked_at: true,
        is_honeypot: true,
        school: {
          select: {
            id: true,
            name: true,
            code: true,
            city: true,
            state: true,
          },
        },
        student: {
          select: {
            id: true,
            first_name: true,
            last_name: true,
            class: true,
            section: true,
            admission_number: true,
            school_id: true,
          },
        },
        batch: {
          select: {
            id: true,
            count: true,
            generated_count: true,
            status: true,
            created_at: true,
            created_by: true,
          },
        },
        order: {
          select: {
            id: true,
            order_number: true,
          },
        },
        scans: {
          take: 5,
          orderBy: { created_at: 'desc' },
          select: {
            id: true,
            result: true,
            created_at: true,
            ip_address: true,
            latitude: true,
            longitude: true,
          },
        },
      },
    });

    if (!token) return null;

    return {
      id: token.id,
      token_hash: token.token_hash,
      status: token.status,
      created_at: token.created_at,
      expires_at: token.expires_at,
      activated_at: token.activated_at,
      revoked_at: token.revoked_at,
      is_honeypot: token.is_honeypot,
      school: token.school,
      student: token.student,
      batch: token.batch,
      order: token.order,
      recent_scans: token.scans,
    };
  }

  async revokeToken(id, reason = null) {
    return prisma.token.update({
      where: { id },
      data: {
        status: 'REVOKED',
        revoked_at: new Date(),
      },
      select: {
        id: true,
        status: true,
        revoked_at: true,
        student: {
          select: {
            id: true,
            first_name: true,
            last_name: true,
          },
        },
      },
    });
  }

  async replaceToken(id, newTokenHash = null) {
    const newHash =
      newTokenHash || `TOK_${Date.now()}_${Math.random().toString(36).substring(2, 15)}`;
    return prisma.token.update({
      where: { id },
      data: {
        token_hash: newHash,
        status: 'UNASSIGNED',
        activated_at: null,
        revoked_at: null,
        student_id: null,
      },
      select: {
        id: true,
        token_hash: true,
        status: true,
      },
    });
  }

  async getTokensStats(daysToExpire = 30) {
    const expiryDate = new Date();
    expiryDate.setDate(expiryDate.getDate() + daysToExpire);

    const [total, active, unassigned, expired, revoked, expiringSoon] = await Promise.all([
      prisma.token.count(),
      prisma.token.count({ where: { status: 'ACTIVE' } }),
      prisma.token.count({ where: { status: 'UNASSIGNED' } }),
      prisma.token.count({ where: { status: 'EXPIRED' } }),
      prisma.token.count({ where: { status: 'REVOKED' } }),
      prisma.token.count({
        where: {
          status: 'ACTIVE',
          expires_at: {
            lte: expiryDate,
            gte: new Date(),
          },
        },
      }),
    ]);

    return {
      total,
      active,
      unassigned,
      expired,
      revoked,
      expiring_soon: expiringSoon,
    };
  }

  async getTokenBatches(schoolId = null) {
    const where = {};
    if (schoolId) {
      where.school_id = schoolId;
    }

    const batches = await prisma.tokenBatch.findMany({
      where,
      select: {
        id: true,
        count: true,
        generated_count: true,
        status: true,
        created_at: true,
        created_by: true,
        school: {
          select: {
            id: true,
            name: true,
            code: true,
          },
        },
        _count: {
          select: {
            tokens: true,
          },
        },
      },
      orderBy: { created_at: 'desc' },
    });

    return batches;
  }
}
