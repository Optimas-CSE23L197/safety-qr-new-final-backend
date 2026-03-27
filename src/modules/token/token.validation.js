// =============================================================================
// token.validation.js — RESQID
// Zod schemas for all 4 token generation endpoints
// =============================================================================

import { z } from 'zod';

// =============================================================================
// SHARED
// =============================================================================

const uuidSchema = z.string().uuid('Must be a valid UUID');

// =============================================================================
// 1. SINGLE BLANK TOKEN
// POST /api/tokens/blank/single
// =============================================================================

export const singleBlankTokenSchema = z.object({
  school_id: uuidSchema,
  order_id: uuidSchema.optional(),
  notes: z.string().max(500).optional(),
});

// =============================================================================
// 2. BULK BLANK TOKENS
// POST /api/tokens/blank/bulk
// =============================================================================

export const bulkBlankTokensSchema = z.object({
  school_id: uuidSchema,
  count: z.number().int().min(1).max(1000),
  order_id: uuidSchema.optional(),
  notes: z.string().max(500).optional(),
});

// =============================================================================
// 3. SINGLE PRE-DETAILS TOKEN
// POST /api/tokens/preloaded/single
// =============================================================================

export const singlePreloadedTokenSchema = z.object({
  school_id: uuidSchema,
  student_id: uuidSchema,
  order_id: uuidSchema.optional(),
  order_item_id: uuidSchema.optional(),
});

// =============================================================================
// 4. BULK PRE-DETAILS TOKENS
// POST /api/tokens/preloaded/bulk
// =============================================================================

export const bulkPreloadedTokensSchema = z.object({
  school_id: uuidSchema,
  student_ids: z.array(uuidSchema).min(1).max(1000),
  order_id: uuidSchema.optional(),
  notes: z.string().max(500).optional(),
});
