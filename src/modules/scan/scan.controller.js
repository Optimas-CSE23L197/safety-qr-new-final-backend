// =============================================================================
// modules/scan/scan.controller.js — RESQID
//
// Handles GET /s/:code — the public QR scan endpoint.
// NO AUTH — guards are entirely in the middleware chain (scan.routes.js).
//
// startTime uses performance.now() for monotonic, drift-safe latency tracking.
// =============================================================================

import { performance } from 'perf_hooks';
import crypto from 'crypto';
import { resolveScan } from './scan.service.js';
import { asyncHandler } from '#shared/response/asyncHandler.js';
import { extractIp } from '#shared/network/extractIp.js';
import { logger } from '#config/logger.js';

const DEVICE_HASH_LENGTH = 16;

export const scanQr = asyncHandler(async (req, res) => {
  const startTime = performance.now(); // FIX: monotonic clock — no NTP drift risk

  const { code } = req.params;
  const ip = extractIp(req);

  // FIX: Multi-header fingerprint — harder to spoof than UA alone
  const fingerprintSource = [
    req.headers['user-agent'] ?? '',
    req.headers['accept-language'] ?? '',
    req.headers['accept-encoding'] ?? '',
    ip,
  ].join('|');

  const deviceHash = crypto
    .createHash('sha256')
    .update(fingerprintSource)
    .digest('hex')
    .slice(0, DEVICE_HASH_LENGTH);

  // FIX: Validate scanCount — don't trust raw req value
  const rawScanCount = req.scanCount;
  const scanCount = Number.isInteger(rawScanCount) && rawScanCount > 0 ? rawScanCount : 1;

  // FIX: Entry log for traceability — captured before service call
  logger.debug(
    { code: code?.slice(0, 8) + '…', ip, deviceHash },
    '[scan.controller] incoming scan'
  );

  // FIX: Set security headers here — Cache-Control critical for emergency data
  res.set({
    'Cache-Control': 'no-store, no-cache, must-revalidate, private',
    'X-Content-Type-Options': 'nosniff',
    'X-Frame-Options': 'DENY',
    'Referrer-Policy': 'no-referrer',
  });

  const result = await resolveScan({
    code,
    ip,
    userAgent: req.headers['user-agent'] ?? null,
    deviceHash,
    startTime,
    scanCount,
  });

  // FIX: Map result state to correct HTTP status code
  const statusMap = {
    ACTIVE: 200,
    INACTIVE: 200,
    UNREGISTERED: 200,
    ISSUED: 200,
    INVALID: 400,
    ERROR: 500,
  };
  const httpStatus = statusMap[result.state] ?? 200;

  return res.status(httpStatus).json(result);
});
