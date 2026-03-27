import { RedisAdapter } from './redis.adapter.js';
import { CacheProvider } from './cache.provider.js';

// ---------------------------------------------------------------------------
// TTL Constants (seconds)
// ---------------------------------------------------------------------------
export const TTL = {
  SCHOOL: 5 * 60, // School settings
  SESSION: 60, // Session active check
  PARENT_CHILDREN: 2 * 60, // Parent-student links
  EMERGENCY_PAGE: 30, // Public emergency page
  TOKEN_STATUS: 60, // Token active / revoked status
  USER_PROFILE: 5 * 60, // User profile
  SCAN_RATE: 60, // Rate-limit windows
  OTP_BLOCK: 15 * 60, // OTP send block
  SHORT: 30, // Volatile data
  MEDIUM: 10 * 60, // Semi-stable data
  LONG: 60 * 60, // Stable reference data
};

// ---------------------------------------------------------------------------
// Cache Key Builders
// ---------------------------------------------------------------------------
export const CacheKey = {
  school: id => `school:${id}`,
  schoolSettings: id => `school:settings:${id}`,
  session: id => `session:${id}`,
  parentChildren: parentId => `parent:children:${parentId}`,
  parentProfile: parentId => `parent:profile:${parentId}`,
  tokenStatus: tokenHash => `token:status:${tokenHash}`,
  emergencyPage: tokenHash => `emergency:${tokenHash}`,
  blacklist: tokenHash => `blacklist:${tokenHash}`,
  scanCount: tokenHash => `scan:count:${tokenHash}`,
  otpBlock: phone => `otp:block:${phone}`,
  ipBlock: ip => `ip:block:${ip}`,
  rateLimitKey: (id, type) => `rl:${type}:${id}`,
};

// ---------------------------------------------------------------------------
// Singleton
// ---------------------------------------------------------------------------
let cacheInstance = null;

export async function initializeCache(config = {}) {
  if (!cacheInstance) {
    const adapter = new RedisAdapter(config);
    await adapter.connect();
    cacheInstance = adapter;
  }
  return cacheInstance;
}

export function getCache() {
  if (!cacheInstance) {
    throw new Error('[Cache] Not initialized. Call initializeCache() before use.');
  }
  return cacheInstance;
}

export { CacheProvider, RedisAdapter };
