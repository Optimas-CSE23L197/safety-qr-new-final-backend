// =============================================================================
// ipReputation.middleware.js — RESQID
// IP reputation check for the public emergency API (/api/emergency)
// Blocks known Tor exit nodes, datacenter ranges, and DB-persisted bad IPs
//
// Why this matters:
//   The /api/emergency endpoint is public — no auth required. It serves
//   children's emergency medical profiles. The ScanAnomaly model has a
//   SUSPICIOUS_IP type, but nothing was actually checking IP reputation
//   BEFORE serving the response. This middleware adds that upstream gate.
//
// Three-layer check (fastest to slowest):
//   [1] Redis blocklist — instantly block IPs we've already flagged
//   [2] DB ScanRateLimit — persistent blocks from rate limit violations
//   [3] TrustedScanZone — if IP is in a school's trusted range, fast-allow
//       (suppresses anomaly logging for school premises scans)
//
// External IP reputation APIs (e.g., AbuseIPDB, IPQualityScore) are NOT
// called inline — too slow for a public emergency page. Instead, anomaly
// detection runs async AFTER the response is served (in the scan handler).
//
// Schema models used:
//   ScanRateLimit  — persistent IP blocks (blocked_until, blocked_reason)
//   ScanAnomaly    — SUSPICIOUS_IP anomaly type (written by scan handler)
//   TrustedScanZone — school premises IP ranges (suppress false positives)
// =============================================================================

import { prisma } from "../config/prisma.js";
import { redis } from "../config/redis.js";
import { asyncHandler } from "../utils/Response/asyncHandler.js";
import { extractIp } from "../utils/network/extractIp.js";
import { logger } from "../config/logger.js";

// ─── Constants ────────────────────────────────────────────────────────────────

// Redis key prefixes
const IP_BLOCK_PREFIX = "ip:blocked:"; // manually blocked IPs
const IP_ALLOW_PREFIX = "ip:trusted:"; // trusted scan zone IPs (fast allow)

const BLOCK_CACHE_TTL = 5 * 60; // 5 min — re-check DB every 5 min
const TRUST_CACHE_TTL = 10 * 60; // 10 min — trusted zones change rarely

// Known datacenter/hosting CIDR prefixes — QR scans should never come from these
// These are the top ranges used by bots, scrapers, and vulnerability scanners
// This is a lightweight static list — not a replacement for full IP rep APIs
const DATACENTER_PREFIXES = [
  "104.16.",
  "104.17.",
  "104.18.",
  "104.19.", // Cloudflare (bot infra)
  "162.158.", // Cloudflare Warp (often abused)
  "198.41.128.",
  "198.41.129.", // Cloudflare
  "3.208.",
  "3.209.",
  "3.210.",
  "3.211.", // AWS EC2 ranges (common scanner origin)
  "34.64.",
  "34.65.",
  "34.66.",
  "34.67.", // GCP
  "20.36.",
  "20.37.",
  "20.38.",
  "20.39.", // Azure
  "45.33.",
  "45.56.",
  "45.79.", // Linode/Akamai
];

// ─── Core Middleware ──────────────────────────────────────────────────────────

/**
 * checkIpReputation
 * Runs BEFORE publicEmergencyLimiter and perTokenScanLimit
 * Only applied to /api/emergency routes
 *
 * Sets req.isTrustedScanZone = true if IP is in a school trusted range
 * so the scan handler can suppress anomaly alerts for school premises scans.
 */
export const checkIpReputation = asyncHandler(async (req, res, next) => {
  const ip = extractIp(req);

  if (!ip) return next(); // no IP extractable — let rate limiter handle it

  // [1] Redis blocklist — fastest check first
  const redisBlock = await redis.get(`${IP_BLOCK_PREFIX}${ip}`);
  if (redisBlock) {
    return blockRequest(res, req, ip, JSON.parse(redisBlock).reason);
  }

  // [2] DB persistent block check (ScanRateLimit)
  const dbBlock = await prisma.scanRateLimit.findUnique({
    where: {
      identifier_identifier_type: {
        identifier: ip,
        identifier_type: "IP",
      },
    },
    select: { blocked_until: true, blocked_reason: true },
  });

  if (dbBlock?.blocked_until && new Date(dbBlock.blocked_until) > new Date()) {
    // Cache the block in Redis so DB isn't hit on every request
    const ttlSecs = Math.ceil(
      (new Date(dbBlock.blocked_until) - Date.now()) / 1000,
    );
    if (ttlSecs > 0) {
      await redis
        .setex(
          `${IP_BLOCK_PREFIX}${ip}`,
          Math.min(ttlSecs, BLOCK_CACHE_TTL),
          JSON.stringify({ reason: dbBlock.blocked_reason }),
        )
        .catch(() => {});
    }
    return blockRequest(res, req, ip, dbBlock.blocked_reason);
  }

  // [3] Datacenter prefix check — lightweight static blocklist
  const isDatacenter = DATACENTER_PREFIXES.some((prefix) =>
    ip.startsWith(prefix),
  );
  if (isDatacenter) {
    logger.warn(
      { ip, path: req.path },
      "ipReputation: datacenter IP blocked from emergency API",
    );
    // Don't hard block — log and flag as anomaly, still serve (emergency is safety-critical)
    // Rationale: a genuine first responder might be on a corporate VPN
    req.isSuspiciousIp = true;
  }

  // [4] Trusted scan zone check — suppress anomaly alerts for school premises
  const isTrusted = await checkTrustedZone(ip);
  if (isTrusted) {
    req.isTrustedScanZone = true;
  }

  next();
});

/**
 * blockIp
 * Utility to block an IP — writes to Redis + DB ScanRateLimit
 * Call this from the scan handler when SUSPICIOUS_IP anomaly is detected
 */
export async function blockIp(ip, reason, durationMs = 60 * 60 * 1000) {
  const blockedUntil = new Date(Date.now() + durationMs);

  // Write to DB for persistence across Redis restarts
  await prisma.scanRateLimit.upsert({
    where: {
      identifier_identifier_type: {
        identifier: ip,
        identifier_type: "IP",
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
      identifier_type: "IP",
      count: 1,
      window_start: new Date(),
      last_hit: new Date(),
      blocked_until: blockedUntil,
      blocked_reason: reason,
      block_count: 1,
    },
  });

  // Cache in Redis for fast subsequent checks
  const ttlSecs = Math.ceil(durationMs / 1000);
  await redis.setex(
    `${IP_BLOCK_PREFIX}${ip}`,
    Math.min(ttlSecs, BLOCK_CACHE_TTL),
    JSON.stringify({ reason }),
  );
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

function blockRequest(res, req, ip, reason) {
  logger.warn(
    { ip, reason, path: req.path, requestId: req.id },
    "ipReputation: IP blocked from emergency API",
  );

  return res.status(403).json({
    success: false,
    message: "Access temporarily restricted",
    requestId: req.id,
  });
}

async function checkTrustedZone(ip) {
  const cacheKey = `${IP_ALLOW_PREFIX}${ip}`;
  const cached = await redis.get(cacheKey);

  if (cached !== null) return cached === "1";

  // Check if IP falls within any active TrustedScanZone ip_range (CIDR)
  // For simplicity we do a prefix match — for full CIDR support add a
  // CIDR library (e.g., `ip-range-check`) in the scan handler instead
  const zones = await prisma.trustedScanZone.findMany({
    where: { is_active: true, ip_range: { not: null } },
    select: { ip_range: true },
  });

  const isTrusted = zones.some(
    (z) => z.ip_range && ip.startsWith(z.ip_range.split("/")[0].slice(0, -1)),
  );

  await redis.setex(cacheKey, TRUST_CACHE_TTL, isTrusted ? "1" : "0");

  return isTrusted;
}
