// =============================================================================
// modules/scan/scan.routes.js — RESQID
//
// Public QR scan routes — NO authentication required.
// Mounted at /s in routes/index.js:
//   router.use("/s", scanRoute)
//
// Full URL: GET https://getresqid.in/s/:code
//   :code — 43-char AES-SIV scan code (base62, 32 bytes encoded)
//
// MIDDLEWARE ORDER — cheapest first, never touch DB for bad requests:
//   1. checkIpBlockedRedis     — O(1) Redis SET lookup, kills known-bad IPs
//   2. publicScanLimiter       — Redis sliding window 30 req/min per IP
//   3. validate(scanCodeSchema)— Zod regex: rejects bad format before anything
//   4. perTokenScanLimit       — Redis 20 scans/hr per token code
//   5. scanQr                  — controller: crypto → cache → DB → respond
//
// WHY validate() is THIRD not first:
//   IP block and rate limit are O(1) Redis reads — faster than Zod.
//   A blocked IP should be rejected before we spend any CPU on schema parsing.
//   validate() before perTokenScanLimit because we only want to count valid
//   code formats against the token limit — malformed codes don't count.
//
// CATCH-ALL NOTE:
//   The catch-all route below the main route is DEAD CODE — Express /:code
//   matches any string including malformed ones. Zod validation in the main
//   route handles format rejection. The catch-all is removed to avoid confusion.
// =============================================================================

import { Router } from 'express';
import { scanQr } from './scan.controller.js';
import { validateAll } from '#middleware/validate.middleware.js';
import {
  checkIpBlockedRedis,
  publicScanLimiter,
  perTokenScanLimit,
} from '#middleware/security/scan.middleware.js';
import { scanCodeSchema } from './scan.validation.js';

const router = Router();

router.get(
  '/:code',
  checkIpBlockedRedis, // 1. Redis O(1) IP block — kills known-bad IPs immediately
  publicScanLimiter, // 2. Redis 30 req/min per IP
  validateAll({ params: scanCodeSchema }),
  perTokenScanLimit, // 4. Redis 20 scans/hr per token
  scanQr // 5. crypto → cache → DB → respond
);

export default router;
