// =============================================================================
// scan/anomaly/anomaly.evaluator.js — RESQID
//
// Anomaly detection for the scan endpoint.
// NEVER runs on the hot path — always fire-and-forget from service layer.
//
// ARCHITECTURE:
//   resolveScan() → respond to user immediately
//                 → setImmediate(() => evaluateAnomaly(...))
//
//   evaluateAnomaly() reads Redis counters, decides severity, writes
//   ScanAnomaly to DB if threshold exceeded, blocks IP in Redis if CRITICAL.
//
// THRESHOLDS:
//   Token > 15 scans/hr   → HIGH anomaly
//   Token > 30 scans/hr   → CRITICAL + IP block
//   IP > 5 distinct tokens in 10 min → BULK_SCRAPING + IP block
//   Honeypot hit          → CRITICAL + instant IP block
//
// WHY setImmediate NOT Promise:
//   setImmediate runs after the current event loop tick completes.
//   This guarantees the response has been sent before anomaly work starts.
//   A Promise.resolve().then() would run in the microtask queue — before
//   the response flush in some Node.js versions. setImmediate is safer.
// =============================================================================

import { prisma } from '#config/prisma.js';
import { logger } from '#config/logger.js';
import {
  incrTokenScanCount,
  incrIpScanCount,
  trackIpTokenScan,
  blockIpInRedis,
} from '../cache/scan.cache.js';

// ── Thresholds ────────────────────────────────────────────────────────────────

const THRESHOLDS = {
  TOKEN_HIGH: 15, // > 15 scans/hr on same token → HIGH
  TOKEN_CRITICAL: 30, // > 30 scans/hr on same token → CRITICAL + block IP
  IP_DISTINCT_TOKENS: 5, // > 5 different tokens from same IP in 10 min → BULK_SCRAPING
};

// ── Main evaluator ────────────────────────────────────────────────────────────

/**
 * Evaluate anomaly signals for a completed scan.
 * Called via setImmediate — never blocks the response.
 *
 * @param {object} params
 * @param {string} params.tokenId
 * @param {string} params.schoolId
 * @param {string} params.ip
 * @param {string} params.scanResult — ScanResult enum value
 * @param {boolean} [params.isHoneypot] — true if this was a honeypot token
 */
export const evaluateAnomaly = async ({ tokenId, schoolId, ip, scanResult, isHoneypot }) => {
  try {
    // ── Honeypot: instant CRITICAL, no further checks needed ─────────────────
    if (isHoneypot) {
      logger.warn({ tokenId, ip }, '[anomaly] HONEYPOT HIT — instant block');
      await Promise.all([
        blockIpInRedis(ip, 'HONEYPOT_TRIGGERED', 60 * 60 * 24 * 7), // 7 day block
        writeScanAnomaly({
          tokenId,
          type: 'HONEYPOT_TRIGGERED',
          severity: 'CRITICAL',
          reason: `Honeypot token scanned from IP ${ip}`,
          metadata: { ip, scanResult },
        }),
      ]);
      return;
    }

    // ── Counter increments (all parallel, all fire-and-forget) ───────────────
    const [tokenCount, , distinctTokenCount] = await Promise.all([
      incrTokenScanCount(tokenId),
      incrIpScanCount(ip),
      trackIpTokenScan(ip, tokenId),
    ]);

    // ── Token frequency anomaly ───────────────────────────────────────────────
    if (tokenCount > THRESHOLDS.TOKEN_CRITICAL) {
      logger.warn({ tokenId, ip, tokenCount }, '[anomaly] CRITICAL token scan frequency');
      await Promise.all([
        blockIpInRedis(ip, 'HIGH_FREQUENCY', 60 * 60 * 24), // 24h block
        writeScanAnomaly({
          tokenId,
          type: 'HIGH_FREQUENCY',
          severity: 'CRITICAL',
          reason: `Token scanned ${tokenCount} times in the last hour`,
          metadata: { tokenCount, ip, scanResult },
        }),
      ]);
      return;
    }

    if (tokenCount > THRESHOLDS.TOKEN_HIGH) {
      logger.info({ tokenId, ip, tokenCount }, '[anomaly] HIGH token scan frequency');
      await writeScanAnomaly({
        tokenId,
        type: 'HIGH_FREQUENCY',
        severity: 'HIGH',
        reason: `Token scanned ${tokenCount} times in the last hour`,
        metadata: { tokenCount, ip, scanResult },
      });
      return;
    }

    // ── Bulk scraping: IP hitting multiple tokens ─────────────────────────────
    if (distinctTokenCount > THRESHOLDS.IP_DISTINCT_TOKENS) {
      logger.warn({ ip, distinctTokenCount }, '[anomaly] BULK_SCRAPING detected');
      await Promise.all([
        blockIpInRedis(ip, 'BULK_SCRAPING', 60 * 60 * 24),
        writeScanAnomaly({
          tokenId,
          type: 'BULK_SCRAPING',
          severity: 'HIGH',
          reason: `IP scanned ${distinctTokenCount} distinct tokens in 10 minutes`,
          metadata: { distinctTokenCount, ip, scanResult },
        }),
      ]);
    }

    // REPEATED_FAILURE: IP keeps hitting INVALID codes
    // This catches token enumeration attempts
    if (scanResult === 'INVALID') {
      const ipCount = await incrIpScanCount(`${ip}:invalid`);
      if (ipCount > 10) {
        logger.warn({ ip, ipCount }, '[anomaly] Repeated INVALID scans from IP');
        await Promise.all([
          blockIpInRedis(ip, 'REPEATED_FAILURE', 60 * 60 * 6), // 6h block
          writeScanAnomaly({
            tokenId,
            type: 'REPEATED_FAILURE',
            severity: 'MEDIUM',
            reason: `IP produced ${ipCount} INVALID scan results in 1 hour`,
            metadata: { ip, ipCount },
          }),
        ]);
      }
    }
  } catch (err) {
    // Anomaly evaluation failure must never propagate
    logger.error({ err: err.message, tokenId }, '[anomaly] evaluateAnomaly threw — swallowed');
  }
};

// ── DB write ──────────────────────────────────────────────────────────────────

/**
 * Write a ScanAnomaly record.
 * Deduplicates: skips write if same tokenId + type has an unresolved record
 * created in the last 10 minutes (prevents anomaly table flood).
 */
const writeScanAnomaly = async ({ tokenId, type, severity, reason, metadata }) => {
  try {
    const tenMinutesAgo = new Date(Date.now() - 10 * 60 * 1000);
    const existing = await prisma.scanAnomaly.findFirst({
      where: {
        token_id: tokenId,
        anomaly_type: type,
        resolved: false,
        created_at: { gte: tenMinutesAgo },
      },
      select: { id: true },
    });

    if (existing) return; // deduplicated

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
