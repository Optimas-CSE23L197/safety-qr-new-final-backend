// =============================================================================
// tokens.service.js — RESQID Super Admin Tokens
// Business logic for token management
// =============================================================================

import { TokensRepository } from './tokens.repository.js';
import { ApiError } from '#shared/response/ApiError.js';

export class TokensService {
  constructor() {
    this.repository = new TokensRepository();
  }

  async listTokens(query) {
    const { page, limit, search, status, batch_id, school_id, sort_field, sort_dir } = query;
    const skip = (page - 1) * limit;

    const { tokens, total } = await this.repository.getTokensList(
      { search, status, batch_id, school_id },
      { skip, take: limit },
      { sort_field, sort_dir }
    );

    return {
      data: tokens,
      meta: {
        total,
        page,
        limit,
        totalPages: Math.ceil(total / limit),
      },
    };
  }

  async getTokenById(id) {
    const token = await this.repository.getTokenById(id);
    if (!token) {
      throw ApiError.notFound('Token');
    }
    return token;
  }

  async revokeToken(id, reason = null) {
    const token = await this.repository.getTokenById(id);
    if (!token) {
      throw ApiError.notFound('Token');
    }
    if (token.status === 'REVOKED') {
      throw ApiError.badRequest('Token is already revoked');
    }
    if (token.status === 'EXPIRED') {
      throw ApiError.badRequest('Cannot revoke an expired token');
    }
    return this.repository.revokeToken(id, reason);
  }

  async replaceToken(id) {
    const token = await this.repository.getTokenById(id);
    if (!token) {
      throw ApiError.notFound('Token');
    }
    return this.repository.replaceToken(id);
  }

  async getStats(daysToExpire = 30) {
    return this.repository.getTokensStats(daysToExpire);
  }

  async getBatches(schoolId = null) {
    return this.repository.getTokenBatches(schoolId);
  }
}
