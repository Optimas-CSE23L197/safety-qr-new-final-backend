// =============================================================================
// middleware/behavioralSecurity.middleware.js — RESQID
// AI-driven behavioral analysis that distinguishes normal users from attackers
// Automatically blocks malicious IPs based on behavioral patterns
//
// INTEGRATION POINTS:
//   - Called after ipBlockMiddleware but before rate limiting
//   - Records failed auth attempts from auth.service.js
//   - Records successful auth for score reduction
//   - Exports admin functions for super admin dashboard
// =============================================================================

import { redis } from '#config/database/redis.js';
import { prisma } from '#config/database/prisma.js';
import { logger } from '#config/logger.js';
import { extractIp } from '#utils/network/extractIp.js';
import { asyncHandler } from '#utils/response/asyncHandler.js';
import { ApiError } from '#utils/response/ApiError.js';
import { ENV } from '#config/env.js';
// =============================================================================
// CONSTANTS
// =============================================================================

const BEHAVIOR_THRESHOLDS = {
  SUSPICIOUS: 50,
  BLOCK: 100,
  PERMANENT_BLOCK: 500,
};

const WINDOWS = {
  SHORT: 60,
  MEDIUM: 300,
  LONG: 3600,
  DAY: 86400,
};

const PATTERNS = {
  PATH_SCAN: [
    '/admin',
    '/wp-admin',
    '/phpmyadmin',
    '/.env',
    '/.git',
    '/api/v1',
    '/api/v2',
    '/api/v3',
    '/graphql',
    '/graphiql',
    '/swagger',
    '/docs',
    '/apidocs',
  ],
  SQL_INJECTION: [
    "' OR '1'='1",
    '" OR "1"="1',
    "' UNION SELECT",
    "'; DROP TABLE",
    "' WAITFOR DELAY",
    '1=1--',
    "admin'--",
    "' OR 1=1#",
  ],
  PATH_TRAVERSAL: ['../', '..\\', '....//', '....\\\\', '%2e%2e%2f', '%252e%252e%252f'],
  SUSPICIOUS_UA: [
    'python-requests',
    'curl',
    'wget',
    'Go-http-client',
    'Nikto',
    'sqlmap',
    'nmap',
    'masscan',
    'BurpSuite',
    'Zgrab',
  ],
};

const NORMAL_PATTERNS = {
  MOBILE_UA: ['ResqidAndroid', 'ResqidiOS', 'Capacitor', 'Mobile'],
  NORMAL_ENDPOINTS: {
    PARENT_USER: [
      '/api/parents/students',
      '/api/parents/emergency',
      '/api/parents/profile',
      '/api/parents/notifications',
      '/api/parents/devices',
    ],
    ADMIN: [
      '/api/school-admin/students',
      '/api/school-admin/dashboard',
      '/api/school-admin/tokens',
      '/api/school-admin/scans',
    ],
    SUPER_ADMIN: ['/api/super-admin/schools', '/api/super-admin/users', '/api/super-admin/orders'],
  },
};

// Trusted IPs (bypass behavioral checks)
const TRUSTED_IPS = new Set([
  '127.0.0.1',
  '::1',
  ...(ENV.TRUSTED_IPS ? ENV.TRUSTED_IPS.split(',') : []),
]);

// =============================================================================
// HELPER FUNCTIONS
// =============================================================================

async function calculateBehavioralScore(ip, requestData) {
  let score = 0;
  const reasons = [];

  // [1] Request rate anomaly
  const rateKey = `behavior:rate:${ip}`;
  const requestCount = await redis.incr(rateKey);
  if (requestCount === 1) await redis.expire(rateKey, WINDOWS.SHORT);

  if (requestCount > 60) {
    score += Math.min((requestCount - 60) * 2, 40);
    reasons.push(`High request rate: ${requestCount}/min`);
  }

  // [2] Path scanning detection
  const pathKey = `behavior:paths:${ip}`;
  const uniquePaths = await redis.sadd(pathKey, requestData.path);
  if (uniquePaths === 1) await redis.expire(pathKey, WINDOWS.MEDIUM);

  const pathCount = await redis.scard(pathKey);
  if (pathCount > 20) {
    score += Math.min((pathCount - 20) * 2, 30);
    reasons.push(`Path scanning: ${pathCount} unique endpoints`);
  }

  // [3] Suspicious endpoint access
  for (const pattern of PATTERNS.PATH_SCAN) {
    if (requestData.path.includes(pattern)) {
      score += 15;
      reasons.push(`Suspicious endpoint: ${pattern}`);
      break;
    }
  }

  // [4] SQL injection attempts
  if (requestData.query || requestData.body) {
    const combinedInput =
      JSON.stringify(requestData.query || {}) + JSON.stringify(requestData.body || {});
    for (const pattern of PATTERNS.SQL_INJECTION) {
      if (combinedInput.toLowerCase().includes(pattern.toLowerCase())) {
        score += 25;
        reasons.push(`SQL injection pattern: ${pattern}`);
        break;
      }
    }
  }

  // [5] Path traversal attempts
  for (const pattern of PATTERNS.PATH_TRAVERSAL) {
    if (requestData.path.includes(pattern)) {
      score += 20;
      reasons.push(`Path traversal: ${pattern}`);
      break;
    }
  }

  // [6] Suspicious user agent
  if (requestData.userAgent) {
    const ua = requestData.userAgent.toLowerCase();
    for (const pattern of PATTERNS.SUSPICIOUS_UA) {
      if (ua.includes(pattern.toLowerCase())) {
        score += 10;
        reasons.push(`Suspicious user agent: ${pattern}`);
        break;
      }
    }

    const isNormalMobile = NORMAL_PATTERNS.MOBILE_UA.some(p => ua.includes(p.toLowerCase()));
    if (!isNormalMobile && !ua.includes('mozilla') && !ua.includes('chrome')) {
      score += 5;
      reasons.push('Non-browser user agent');
    }
  }

  // [7] Failed auth attempts
  const authKey = `behavior:auth:${ip}`;
  const authFails = parseInt((await redis.get(authKey)) || '0', 10);
  if (authFails > 0) {
    score += Math.min(authFails * 5, 40);
    reasons.push(`${authFails} failed auth attempts`);
  }

  // [8] Time-based anomaly
  const hour = new Date().getHours();
  const isSchoolHour = hour >= 8 && hour <= 18;
  const isParentHour = hour >= 6 && hour <= 22;

  if (requestData.role === 'ADMIN' && !isSchoolHour) {
    score += 5;
    reasons.push('Admin access outside school hours');
  }
  if (requestData.role === 'PARENT_USER' && !isParentHour) {
    score += 3;
    reasons.push('Parent access outside normal hours');
  }

  // [9] Endpoint mismatch
  if (requestData.role && NORMAL_PATTERNS.NORMAL_ENDPOINTS[requestData.role]) {
    const normalEndpoints = NORMAL_PATTERNS.NORMAL_ENDPOINTS[requestData.role];
    const isNormalEndpoint = normalEndpoints.some(e => requestData.path.startsWith(e));
    if (!isNormalEndpoint && !requestData.path.startsWith('/api/auth')) {
      score += 10;
      reasons.push(`Unusual endpoint for role ${requestData.role}: ${requestData.path}`);
    }
  }

  // Store score
  await redis.setex(
    `behavior:score:${ip}`,
    WINDOWS.LONG,
    JSON.stringify({ score, reasons, updatedAt: new Date().toISOString() })
  );

  return { score, reasons };
}

async function getBehavioralScore(ip) {
  const cached = await redis.get(`behavior:score:${ip}`);
  if (cached) return JSON.parse(cached);
  return { score: 0, reasons: [] };
}

async function blockIpBehavioral(ip, score, reasons) {
  const blockUntil = new Date(Date.now() + WINDOWS.LONG * 1000);
  const isPermanent = score >= BEHAVIOR_THRESHOLDS.PERMANENT_BLOCK;

  await redis.setex(
    `blocked:behavioral:${ip}`,
    isPermanent ? WINDOWS.DAY : WINDOWS.LONG,
    JSON.stringify({
      reason: 'Behavioral detection',
      score,
      reasons,
      blockedAt: new Date().toISOString(),
      blockUntil: blockUntil.toISOString(),
      isPermanent,
    })
  );

  await prisma.scanRateLimit.upsert({
    where: {
      identifier_identifier_type: {
        identifier: ip,
        identifier_type: 'IP',
      },
    },
    update: {
      block_count: { increment: 1 },
      blocked_until: blockUntil,
      blocked_reason: `BEHAVIORAL_BLOCK_${score}`,
      last_hit: new Date(),
      metadata: { behavioralScore: score, reasons },
    },
    create: {
      identifier: ip,
      identifier_type: 'IP',
      count: 1,
      block_count: 1,
      blocked_until: blockUntil,
      blocked_reason: `BEHAVIORAL_BLOCK_${score}`,
      window_start: new Date(),
      last_hit: new Date(),
      metadata: { behavioralScore: score, reasons },
    },
  });

  logger.warn(
    { ip, score, reasons, isPermanent, blockUntil: blockUntil.toISOString() },
    `🚫 IP ${ip} behaviorally blocked (score: ${score})`
  );
}

// =============================================================================
// EXPORTED FUNCTIONS (Used by auth.service.js and other modules)
// =============================================================================

export async function recordFailedAuth(ip, identifier, reason) {
  if (TRUSTED_IPS.has(ip)) return;

  const authKey = `behavior:auth:${ip}`;
  const attempts = await redis.incr(authKey);
  if (attempts === 1) await redis.expire(authKey, WINDOWS.LONG);

  const { score, reasons } = await getBehavioralScore(ip);
  const newScore = score + 15;

  if (newScore >= BEHAVIOR_THRESHOLDS.BLOCK) {
    reasons.push(`${attempts} failed auth attempts`);
    await blockIpBehavioral(ip, newScore, reasons);
  }

  await prisma.auditLog
    .create({
      data: {
        actor_id: identifier || ip,
        actor_type: 'SYSTEM',
        action: 'AUTH_FAILED',
        entity: 'AuthAttempt',
        ip_address: ip,
        metadata: { reason, attemptCount: attempts, behavioralScore: newScore },
      },
    })
    .catch(() => {});
}

export async function recordSuccessfulAuth(ip, userId, role) {
  if (TRUSTED_IPS.has(ip)) return;

  await redis.del(`behavior:auth:${ip}`);

  const { score, reasons } = await getBehavioralScore(ip);
  if (score > 0) {
    const newScore = Math.max(0, score - 20);
    await redis.setex(
      `behavior:score:${ip}`,
      WINDOWS.LONG,
      JSON.stringify({
        score: newScore,
        reasons,
        lastSuccess: new Date().toISOString(),
      })
    );

    const isBlocked = await redis.get(`blocked:behavioral:${ip}`);
    if (isBlocked && newScore < BEHAVIOR_THRESHOLDS.SUSPICIOUS) {
      await redis.del(`blocked:behavioral:${ip}`);
      logger.info({ ip, userId, role }, `IP ${ip} unblocked after successful auth`);
    }
  }
}

// =============================================================================
// MAIN MIDDLEWARE
// =============================================================================

export const behavioralSecurity = asyncHandler(async (req, res, next) => {
  const ip = extractIp(req);

  // Skip for trusted IPs
  if (TRUSTED_IPS.has(ip)) return next();

  // Check if already blocked
  const isBlocked = await redis.get(`blocked:behavioral:${ip}`);
  if (isBlocked) {
    const blockData = JSON.parse(isBlocked);
    logger.warn({ ip, score: blockData.score }, 'Behaviorally blocked IP attempted access');
    throw ApiError.forbidden('Access denied due to suspicious activity');
  }

  // Prepare request data
  const requestData = {
    path: req.path,
    method: req.method,
    userAgent: req.headers['user-agent'] || '',
    role: req.role || null,
    userId: req.userId || null,
    query: req.query,
    body: req.body ? Object.keys(req.body) : null,
  };

  const { score, reasons } = await calculateBehavioralScore(ip, requestData);

  if (score > 0) res.setHeader('X-Behavioral-Score', score);

  if (score >= BEHAVIOR_THRESHOLDS.SUSPICIOUS) {
    logger.warn({ ip, score, reasons, path: req.path }, `⚠️ Suspicious activity (score: ${score})`);

    if (score >= BEHAVIOR_THRESHOLDS.SUSPICIOUS && score < BEHAVIOR_THRESHOLDS.BLOCK) {
      const delay = Math.min(score * 10, 2000);
      await new Promise(resolve => setTimeout(resolve, delay));
    }
  }

  if (score >= BEHAVIOR_THRESHOLDS.BLOCK) {
    await blockIpBehavioral(ip, score, reasons);
    throw ApiError.forbidden('Access denied due to suspicious activity');
  }

  next();
});

// =============================================================================
// ADMIN FUNCTIONS (For Super Admin Dashboard)
// =============================================================================

export async function getBehavioralReport() {
  const keys = await redis.keys('behavior:score:*');
  const reports = [];

  for (const key of keys) {
    const ip = key.replace('behavior:score:', '');
    const data = await redis.get(key);
    if (data) {
      const parsed = JSON.parse(data);
      reports.push({ ip, ...parsed });
    }
  }

  reports.sort((a, b) => b.score - a.score);

  return {
    totalSuspicious: reports.filter(r => r.score >= BEHAVIOR_THRESHOLDS.SUSPICIOUS).length,
    totalBlocked: reports.filter(r => r.score >= BEHAVIOR_THRESHOLDS.BLOCK).length,
    topOffenders: reports.slice(0, 20),
  };
}

export async function whitelistIp(ip, reason, adminId) {
  await redis.del(`behavior:score:${ip}`);
  await redis.del(`blocked:behavioral:${ip}`);
  await redis.del(`behavior:rate:${ip}`);
  await redis.del(`behavior:auth:${ip}`);
  await redis.del(`behavior:paths:${ip}`);

  await redis.setex(`whitelist:${ip}`, WINDOWS.DAY * 30, JSON.stringify({ reason, adminId }));

  await prisma.scanRateLimit.updateMany({
    where: { identifier: ip, identifier_type: 'IP' },
    data: { blocked_until: null, blocked_reason: `WHITELISTED_BY_${adminId}` },
  });

  logger.info({ ip, reason, adminId }, 'IP whitelisted');
}

export async function blacklistIp(ip, reason, adminId) {
  await blockIpBehavioral(ip, BEHAVIOR_THRESHOLDS.PERMANENT_BLOCK, [reason]);
  logger.warn({ ip, reason, adminId }, 'IP manually blacklisted');
}

export async function behavioralCleanup() {
  const pattern = 'behavior:*';
  const keys = await redis.keys(pattern);
  let deleted = 0;

  for (const key of keys) {
    const ttl = await redis.ttl(key);
    if (ttl <= 0) {
      await redis.del(key);
      deleted++;
    }
  }

  logger.info({ deleted, total: keys.length }, 'Behavioral cleanup completed');
  return { deleted, total: keys.length };
}
