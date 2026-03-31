// =============================================================================
// ipReputation.middleware.js — RESQID
// STRICT MODE — Zero tolerance for suspicious IPs on public emergency API
// Blocks known Tor exit nodes, datacenter ranges, and DB-persisted bad IPs
//
// Three-layer check (fastest to slowest):
//   [1] Redis blocklist — instantly block IPs we've already flagged
//   [2] DB ScanRateLimit — persistent blocks from rate limit violations
//   [3] Datacenter prefix check — BLOCK immediately (no mercy)
//   [4] TrustedScanZone — only bypass if explicitly whitelisted
// =============================================================================

import { prisma } from '#config/prisma.js';
import { redis } from '#config/redis.js';
import { asyncHandler } from '#shared/response/asyncHandler.js';
import { extractIp } from '#shared/network/extractIp.js';
import { logger } from '#config/logger.js';

// ─── Constants — STRICT MODE ─────────────────────────────────────────────────

// Redis key prefixes
const IP_BLOCK_PREFIX = 'ip:blocked:';
const IP_ALLOW_PREFIX = 'ip:trusted:';

const BLOCK_CACHE_TTL = 5 * 60; // 5 min
const TRUST_CACHE_TTL = 10 * 60; // 10 min

// KNOWN MALICIOUS IP RANGES — BLOCK IMMEDIATELY
// Datacenter/hosting ranges — QR scans should NEVER come from these
const DATACENTER_PREFIXES = [
  '104.16.',
  '104.17.',
  '104.18.',
  '104.19.', // Cloudflare
  '162.158.', // Cloudflare Warp
  '198.41.128.',
  '198.41.129.', // Cloudflare
  '3.208.',
  '3.209.',
  '3.210.',
  '3.211.', // AWS EC2
  '34.64.',
  '34.65.',
  '34.66.',
  '34.67.', // GCP
  '20.36.',
  '20.37.',
  '20.38.',
  '20.39.', // Azure
  '45.33.',
  '45.56.',
  '45.79.', // Linode/Akamai
  '54.',
  '52.',
  '13.', // AWS global ranges (strict)
  '18.', // AWS
  '35.', // GCP
];

// Tor exit nodes — hardcoded common prefixes (full list should be from external API)
const TOR_PREFIXES = [
  '5.9.',
  '46.165.',
  '62.210.',
  '66.111.',
  '77.247.',
  '82.94.',
  '86.59.',
  '89.18.',
  '93.95.',
  '109.163.',
  '131.188.',
  '176.126.',
  '178.17.',
  '185.100.',
  '193.11.',
  '195.176.',
  '212.47.',
];

// IPs that should NEVER be blocked (only loopback and health checks)
const NEVER_BLOCK = ['127.0.0.1', '::1', '::ffff:127.0.0.1'];

// ─── Core Middleware — STRICT ─────────────────────────────────────────────────

export const checkIpReputation = asyncHandler(async (req, res, next) => {
  const ip = extractIp(req);

  if (!ip) return next();
  if (NEVER_BLOCK.includes(ip)) return next();

  // [1] Redis blocklist — fastest check
  const redisBlock = await redis.get(`${IP_BLOCK_PREFIX}${ip}`);
  if (redisBlock) {
    const blockData = JSON.parse(redisBlock);
    logger.warn({ ip, reason: blockData.reason }, 'STRICT: Blocked IP (Redis)');
    return blockRequest(res, req, ip, blockData.reason);
  }

  // [2] DB persistent block check
  const dbBlock = await prisma.scanRateLimit.findUnique({
    where: {
      identifier_identifier_type: {
        identifier: ip,
        identifier_type: 'IP',
      },
    },
    select: { blocked_until: true, blocked_reason: true, block_count: true },
  });

  if (dbBlock?.blocked_until && new Date(dbBlock.blocked_until) > new Date()) {
    const ttlSecs = Math.ceil((new Date(dbBlock.blocked_until) - Date.now()) / 1000);
    if (ttlSecs > 0) {
      await redis
        .setex(
          `${IP_BLOCK_PREFIX}${ip}`,
          Math.min(ttlSecs, BLOCK_CACHE_TTL),
          JSON.stringify({ reason: dbBlock.blocked_reason, blockCount: dbBlock.block_count })
        )
        .catch(() => {});
    }
    logger.warn(
      { ip, reason: dbBlock.blocked_reason, blockCount: dbBlock.block_count },
      'STRICT: Blocked IP (DB)'
    );
    return blockRequest(res, req, ip, dbBlock.blocked_reason);
  }

  // [3] Datacenter prefix check — BLOCK IMMEDIATELY (no mercy)
  const isDatacenter = DATACENTER_PREFIXES.some(prefix => ip.startsWith(prefix));
  if (isDatacenter) {
    logger.warn({ ip, type: 'datacenter' }, 'STRICT: Datacenter IP blocked');
    // Block immediately — datacenter IPs should NEVER scan emergency QR codes
    await blockIp(ip, 'DATACENTER_BLOCK', 7 * 24 * 60 * 60 * 1000); // 7 days block
    return blockRequest(res, req, ip, 'Datacenter IP not permitted');
  }

  // [4] Tor exit node check — BLOCK IMMEDIATELY
  const isTor = TOR_PREFIXES.some(prefix => ip.startsWith(prefix));
  if (isTor) {
    logger.warn({ ip, type: 'tor' }, 'STRICT: Tor exit node blocked');
    await blockIp(ip, 'TOR_EXIT_NODE_BLOCK', 30 * 24 * 60 * 60 * 1000); // 30 days block
    return blockRequest(res, req, ip, 'Tor network not permitted');
  }

  // [5] Trusted scan zone check — ONLY bypass if explicitly whitelisted
  const isTrusted = await checkTrustedZone(ip);
  if (isTrusted) {
    req.isTrustedScanZone = true;
    return next();
  }

  // [6] Suspicious IP flag — for monitoring only (still allowed)
  // This is for corporate VPNs that might be in datacenter ranges
  req.isSuspiciousIp = false;
  next();
});

// ─── Block IP Helper — STRICT ────────────────────────────────────────────────

export async function blockIp(ip, reason, durationMs = 7 * 24 * 60 * 60 * 1000) {
  if (NEVER_BLOCK.includes(ip)) return;

  const blockedUntil = new Date(Date.now() + durationMs);

  await prisma.scanRateLimit.upsert({
    where: {
      identifier_identifier_type: {
        identifier: ip,
        identifier_type: 'IP',
      },
    },
    update: {
      blocked_until: blockedUntil,
      blocked_reason: reason,
      block_count: { increment: 1 },
      last_hit: new Date(),
    },
    create: {
      identifier: ip,
      identifier_type: 'IP',
      count: 1,
      window_start: new Date(),
      last_hit: new Date(),
      blocked_until: blockedUntil,
      blocked_reason: reason,
      block_count: 1,
    },
  });

  const ttlSecs = Math.ceil(durationMs / 1000);
  await redis.setex(
    `${IP_BLOCK_PREFIX}${ip}`,
    Math.min(ttlSecs, BLOCK_CACHE_TTL),
    JSON.stringify({ reason, blockedUntil: blockedUntil.toISOString() })
  );

  logger.warn(
    { ip, reason, durationMs: Math.floor(durationMs / 86400000), blockedUntil },
    `🔒 IP BLOCKED: ${ip} (${reason})`
  );
}

// ─── Whitelist Helper (for schools) ──────────────────────────────────────────

export async function whitelistIp(ip, reason) {
  if (NEVER_BLOCK.includes(ip)) return;

  // Remove any existing blocks
  await redis.del(`${IP_BLOCK_PREFIX}${ip}`);

  // Set trusted flag with long TTL
  await redis.setex(`${IP_ALLOW_PREFIX}${ip}`, TRUST_CACHE_TTL * 6, '1');

  logger.info({ ip, reason }, `✅ IP WHITELISTED: ${ip} (${reason})`);
}

// ─── Helpers ─────────────────────────────────────────────────────────────────

function blockRequest(res, req, ip, reason) {
  logger.warn(
    { ip, reason, path: req.path, requestId: req.id },
    `🚫 IP REPUTATION BLOCK: ${ip} - ${reason}`
  );

  return res.status(403).json({
    success: false,
    message: 'Access temporarily restricted',
    requestId: req.id,
  });
}

async function checkTrustedZone(ip) {
  const cacheKey = `${IP_ALLOW_PREFIX}${ip}`;
  const cached = await redis.get(cacheKey);
  if (cached !== null) return cached === '1';

  const zones = await prisma.trustedScanZone.findMany({
    where: { is_active: true, ip_range: { not: null } },
    select: { ip_range: true },
  });

  // Simple prefix match (full CIDR support would need ip-range-check library)
  const isTrusted = zones.some(
    z => z.ip_range && ip.startsWith(z.ip_range.split('/')[0].slice(0, -1))
  );

  await redis.setex(cacheKey, TRUST_CACHE_TTL, isTrusted ? '1' : '0');
  return isTrusted;
}
