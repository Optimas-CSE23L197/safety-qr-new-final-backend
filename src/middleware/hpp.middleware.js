// =============================================================================
// hpp.middleware.js — RESQID
// HTTP Parameter Pollution prevention
// Prevents ?role=PARENT_USER&role=SUPER_ADMIN type attacks
// =============================================================================

import hpp from 'hpp';

/**
 * hppProtection
 * By default: duplicate params → takes LAST value (most dangerous)
 * With hpp: selects first value, others stripped
 * Whitelist: params legitimately expecting arrays
 */
export const hppProtection = hpp({
  whitelist: [
    'ids', // bulk operations: DELETE /students?ids[]=x&ids[]=y
    'status', // filter by multiple statuses
    'type', // filter by multiple types
  ],
});
