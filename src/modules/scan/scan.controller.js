// =============================================================================
// modules/scan/scan.controller.js — RESQID
//
// Handles GET /s/:code — the public QR scan endpoint.
//
// NO AUTH — this endpoint is called by anyone who scans a QR code.
// Guards are entirely in the middleware chain (see scan.routes.js).
//
// startTime is captured HERE at controller entry, not in the service.
// This measures total time including middleware overhead, giving accurate
// response_time_ms in ScanLog for p99 tracking.
// =============================================================================

import { resolveScan } from './scan.service.js';
import { ApiResponse } from '#shared/response/ApiResponse.js';
import { asyncHandler } from '#shared/response/asyncHandler.js';
import { extractIp } from '#shared/network/extractIp.js';
import crypto from 'crypto';

const TARGET_RESPONSE_SIZE = 600;

export const scanQr = asyncHandler(async (req, res) => {
  const startTime = Date.now();
  const { code } = req.params;
  const ip = extractIp(req);

  // Device fingerprint — SHA-256 of UA only (stable across network changes)
  // No PII stored — only used for anomaly detection in ScanLog.
  const deviceHash = crypto
    .createHash('sha256')
    .update(`${req.headers['user-agent'] ?? ''}`)
    .digest('hex')
    .slice(0, 16);

  const result = await resolveScan({
    code,
    ip,
    userAgent: req.headers['user-agent'] ?? null,
    deviceHash,
    startTime,
    scanCount: req.scanCount ?? 1,
  });

  const response = ApiResponse.ok(result, 'Scan resolved');
  const responseString = JSON.stringify(response);
  const paddingLength = Math.max(0, TARGET_RESPONSE_SIZE - responseString.length);
  if (paddingLength > 0) {
    response._pad = crypto.randomBytes(paddingLength).toString('hex');
  }
  return res.json(response);
});
