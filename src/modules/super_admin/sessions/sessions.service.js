// =============================================================================
// sessions.service.js — RESQID Super Admin Sessions
// Business logic for session management
// =============================================================================

import { SessionsRepository } from './sessions.repository.js';
import { ApiError } from '#shared/response/ApiError.js';
import { prisma } from '#config/prisma.js';

export class SessionsService {
  constructor() {
    this.repository = new SessionsRepository();
  }

  async listSessions(query) {
    const { page, limit, search, user_type, platform, last_active, status, sort_field, sort_dir } =
      query;
    const skip = (page - 1) * limit;

    const { sessions, total } = await this.repository.getSessionsList(
      { search, user_type, platform, last_active, status },
      { skip, take: limit },
      { sort_field, sort_dir }
    );

    return {
      data: sessions,
      meta: {
        total,
        page,
        limit,
        totalPages: Math.ceil(total / limit),
      },
    };
  }

  async revokeSession(id, reason = null) {
    const session = await prisma.session.findUnique({
      where: { id },
      select: { id: true, is_active: true, revoked_at: true },
    });

    if (!session) {
      throw ApiError.notFound('Session');
    }

    if (!session.is_active || session.revoked_at) {
      throw ApiError.badRequest('Session is already revoked or inactive');
    }

    return this.repository.revokeSession(id, reason);
  }

  async revokeAllSessions(reason = null) {
    const count = await this.repository.revokeAllSessions(reason);
    return {
      revoked_count: count,
      message: `${count} session(s) revoked successfully`,
    };
  }

  async getStats() {
    return this.repository.getSessionsStats();
  }
}
