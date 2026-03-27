// =============================================================================
// modules/scan/scan.controller.js — RESQID
//
// Handles GET /s/:code — the public QR scan endpoint.
//
// NO AUTH — this endpoint is called by anyone who scans a QR code.
// Guards are entirely in the middleware chain (see scan.routes.js):
//   checkIpBlocked → publicEmergencyLimiter → perTokenScanLimit → here
//
// CHANGES FROM PREVIOUS VERSION:
//   [FIX-1] req.scanCount forwarded to resolveScan so service can use it
//           for anomaly threshold decisions without a redundant Redis read
// =============================================================================

import { resolveScan } from './scan.service.js';
import { ApiResponse } from '#utils/response/ApiResponse.js';
import { asyncHandler } from '#utils/response/asyncHandler.js';
import { extractIp } from '#utils/network/extractIp.js';
import crypto from 'crypto';

export const scanQr = asyncHandler(async (req, res) => {
  const startTime = Date.now();
  const { code } = req.params;

  // Simple device fingerprint — no PII, just for anomaly detection in ScanLog.
  // SHA-256 of UA + IP gives a stable 64-char hex; we only need the first 16.
  const deviceHash = crypto
    .createHash('sha256')
    .update(`${req.headers['user-agent'] ?? ''}:${extractIp(req)}`)
    .digest('hex')
    .slice(0, 16);

  const result = await resolveScan({
    code,
    ip: extractIp(req),
    userAgent: req.headers['user-agent'] ?? null,
    deviceHash,
    startTime,
    // [FIX-1] perTokenScanLimit middleware sets req.scanCount before we get here.
    // Pass it down so the service can flag anomalies without a second Redis read.
    scanCount: req.scanCount ?? 1,
  });

  // All states return 200 — the mobile scanner / PWA reads the `state` field.
  // Returning 404 for REVOKED/EXPIRED would leak token existence to attackers.
  return res.json(ApiResponse.ok(result, 'Scan resolved'));
});
