// =============================================================================
// scan/middleware/scan.security.js — RESQID
//
// All security middleware for the public scan endpoint.
// Every check here runs before the controller touches crypto or DB.
// =============================================================================
import crypto from 'crypto';
import { RateLimiterRedis } from 'rate-limiter-flexible';
import { redis } from '#config/redis.js';
import { logger } from '#config/logger.js';
import { isIpBlocked } from '#shared/cache/scan.cache.js';
import { extractIp } from '#shared/network/extractIp.js';

// Whitelist internal monitoring IPs (Railway health checks, etc.)
const trustedIpList = ['127.0.0.1', '::1'];
if (process.env.MONITORING_IP) trustedIpList.push(process.env.MONITORING_IP);
const TRUSTED_IPS = new Set(trustedIpList);

// School static IPs (bypass rate limits) — load from env
const schoolGatewayList = (process.env.SCHOOL_GATEWAY_IPS || '')
  .split(',')
  .filter(ip => ip && ip.trim())
  .map(ip => ip.trim());
const SCHOOL_GATEWAY_IPS = new Set(schoolGatewayList);

const ipLimiter = new RateLimiterRedis({
  storeClient: redis,
  keyPrefix: 'rl:scan:ip',
  points: 30,
  duration: 60,
  blockDuration: 60,
});

const tokenLimiter = new RateLimiterRedis({
  storeClient: redis,
  keyPrefix: 'rl:scan:token',
  points: 20,
  duration: 3600,
  blockDuration: 300, // 5 minutes
});

const blockedResponse = (res, message = 'Too many requests.') =>
  res.status(429).json({ success: false, message });

export const checkIpBlockedRedis = async (req, res, next) => {
  const ip = extractIp(req);

  if (TRUSTED_IPS.has(ip) || SCHOOL_GATEWAY_IPS.has(ip)) {
    return next();
  }

  try {
    const blocked = await isIpBlocked(ip);
    if (blocked) {
      logger.info({ ip }, '[scan.security] Blocked IP rejected');
      return blockedResponse(res);
    }
    next();
  } catch (err) {
    logger.error({ err: err.message, ip }, '[scan.security] checkIpBlockedRedis error — passing');
    next();
  }
};

export const publicScanLimiter = async (req, res, next) => {
  const ip = extractIp(req);

  if (TRUSTED_IPS.has(ip) || SCHOOL_GATEWAY_IPS.has(ip)) {
    return next();
  }

  try {
    await ipLimiter.consume(ip);
    next();
  } catch (err) {
    if (err.msBeforeNext !== undefined) {
      logger.info({ ip }, '[scan.security] IP rate limit exceeded');
      return blockedResponse(res);
    }
    logger.error({ err: err.message, ip }, '[scan.security] publicScanLimiter error — passing');
    next();
  }
};

export const perTokenScanLimit = async (req, res, next) => {
  const { code } = req.params;
  try {
    const hashedCode = crypto.createHash('sha256').update(code).digest('hex');
    const result = await tokenLimiter.consume(hashedCode);
    req.scanCount = tokenLimiter.points - result.remainingPoints;
    next();
  } catch (err) {
    if (err.msBeforeNext !== undefined) {
      logger.info({ codePrefix: code?.slice(0, 8) }, '[scan.security] Token rate limit exceeded');
      return blockedResponse(res, 'This QR code has been scanned too many times recently.');
    }
    logger.error({ err: err.message }, '[scan.security] perTokenScanLimit error — passing');
    req.scanCount = 1;
    next();
  }
};
