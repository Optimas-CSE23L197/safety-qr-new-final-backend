// =============================================================================
// scan/anomaly/anomaly.evaluator.js — RESQID
//
// Anomaly detection for the scan endpoint.
// NEVER runs on the hot path — always fire-and-forget from service layer.
// =============================================================================

import { prisma } from '#config/prisma.js';
import { logger } from '#config/logger.js';
import {
  incrTokenScanCount,
  incrIpScanCount,
  trackIpTokenScan,
  blockIpInRedis,
} from '../cache/scan.cache.js';

const THRESHOLDS = {
  TOKEN_HIGH: 15,
  TOKEN_CRITICAL: 30,
  IP_DISTINCT_TOKENS: 5,
  INVALID_ATTEMPTS: 10,
};

const DEDUP_WINDOW_MINUTES = 60;

export const evaluateAnomaly = async ({
  tokenId,
  schoolId,
  ip,
  scanResult,
  isHoneypot,
  scanCount,
}) => {
  try {
    if (isHoneypot) {
      logger.warn({ tokenId, ip }, '[anomaly] HONEYPOT HIT — instant block');
      await Promise.allSettled([
        blockIpInRedis(ip, 'HONEYPOT_TRIGGERED', 60 * 60 * 24 * 7),
        writeScanAnomaly({
          tokenId,
          schoolId,
          type: 'HONEYPOT_TRIGGERED',
          severity: 'CRITICAL',
          reason: `Honeypot token scanned from IP ${ip}`,
          metadata: { ip, scanResult },
        }),
      ]);
      return;
    }

    const [tokenCount, , distinctTokenCount] = await Promise.all([
      incrTokenScanCount(tokenId),
      incrIpScanCount(ip),
      trackIpTokenScan(ip, tokenId),
    ]);

    if (tokenCount > THRESHOLDS.TOKEN_CRITICAL) {
      logger.warn({ tokenId, ip, tokenCount }, '[anomaly] CRITICAL token scan frequency');
      await Promise.allSettled([
        blockIpInRedis(ip, 'HIGH_FREQUENCY', 60 * 60 * 24),
        writeScanAnomaly({
          tokenId,
          schoolId,
          type: 'HIGH_FREQUENCY',
          severity: 'CRITICAL',
          reason: `Token scanned ${tokenCount} times in the last hour`,
          metadata: { tokenCount, ip, scanResult, scanCount },
        }),
      ]);
      return;
    }

    if (tokenCount > THRESHOLDS.TOKEN_HIGH) {
      logger.info({ tokenId, ip, tokenCount }, '[anomaly] HIGH token scan frequency');
      await writeScanAnomaly({
        tokenId,
        schoolId,
        type: 'HIGH_FREQUENCY',
        severity: 'HIGH',
        reason: `Token scanned ${tokenCount} times in the last hour`,
        metadata: { tokenCount, ip, scanResult, scanCount },
      });
      return;
    }

    if (distinctTokenCount > THRESHOLDS.IP_DISTINCT_TOKENS) {
      logger.warn({ ip, distinctTokenCount }, '[anomaly] BULK_SCRAPING detected');
      await Promise.allSettled([
        blockIpInRedis(ip, 'BULK_SCRAPING', 60 * 60 * 24),
        writeScanAnomaly({
          tokenId,
          schoolId,
          type: 'BULK_SCRAPING',
          severity: 'HIGH',
          reason: `IP scanned ${distinctTokenCount} distinct tokens in 10 minutes`,
          metadata: { distinctTokenCount, ip, scanResult },
        }),
      ]);
    }

    if (scanResult === 'INVALID') {
      const invalidKey = `scan:count:ip:${ip}:invalid`;
      const ipCount = await incrIpScanCountWithKey(invalidKey, 3600);
      if (ipCount > THRESHOLDS.INVALID_ATTEMPTS) {
        logger.warn({ ip, ipCount }, '[anomaly] Repeated INVALID scans from IP');
        await Promise.allSettled([
          blockIpInRedis(ip, 'REPEATED_FAILURE', 60 * 60 * 6),
          writeScanAnomaly({
            tokenId,
            schoolId,
            type: 'REPEATED_FAILURE',
            severity: 'MEDIUM',
            reason: `IP produced ${ipCount} INVALID scan results in 1 hour`,
            metadata: { ip, ipCount },
          }),
        ]);
      }
    }
  } catch (err) {
    logger.error({ err: err.message, tokenId }, '[anomaly] evaluateAnomaly threw — swallowed');
  }
};

const incrIpScanCountWithKey = async (key, ttlSeconds = 3600) => {
  try {
    const { redis } = await import('#config/redis.js');
    const count = await redis.incr(key);
    if (count === 1) await redis.expire(key, ttlSeconds);
    return count;
  } catch {
    return 0;
  }
};

const writeScanAnomaly = async ({ tokenId, schoolId, type, severity, reason, metadata }) => {
  try {
    const cutoffTime = new Date(Date.now() - DEDUP_WINDOW_MINUTES * 60 * 1000);
    const existing = await prisma.scanAnomaly.findFirst({
      where: {
        token_id: tokenId,
        anomaly_type: type,
        resolved: false,
        created_at: { gte: cutoffTime },
      },
      select: { id: true },
    });

    if (existing) return;

    await prisma.scanAnomaly.create({
      data: {
        token_id: tokenId,
        anomaly_type: type,
        severity,
        reason,
        metadata,
      },
    });
  } catch (err) {
    logger.error({ err: err.message, tokenId, type }, '[anomaly] writeScanAnomaly failed');
  }
};
