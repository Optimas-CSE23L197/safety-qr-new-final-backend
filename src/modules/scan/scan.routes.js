// =============================================================================
// modules/scan/scan.routes.js — RESQID
//
// Public QR scan routes — NO authentication required.
// Mounted at /s in routes/index.js:
//   router.use("/s", scanRoute)
//
// ROUTES:
//   GET /s/:code                        — main QR scan, returns HTML or JSON
//   GET /s/call/:contactId/:token       — redirect to tel: (guardian call)
//   GET /s/wa/:contactId/:token         — redirect to wa.me (guardian WhatsApp)
//   GET /s/school-call/:token           — redirect to tel: (school)
//   GET /s/doctor-call/:token           — redirect to tel: (doctor)
//
// IMPORTANT — ROUTE ORDER:
//   Specific static-prefix routes (/call, /wa, /school-call, /doctor-call)
//   MUST be declared BEFORE the wildcard /:code route.
//   Express matches routes in declaration order — if /:code comes first,
//   it swallows all traffic including /s/call/... etc.
//
// MIDDLEWARE ORDER for /:code — cheapest first:
//   1. scanCors              — block cross-origin JS fetch
//   2. serveHtmlForBrowser   — serve emergency.html to browser requests
//   3. checkIpBlockedRedis   — O(1) Redis SET lookup, kills known-bad IPs
//   4. publicScanLimiter     — Redis sliding window 30 req/min per IP
//   5. validateAll()         — Zod regex: rejects bad format before DB touch
//   6. perTokenScanLimit     — Redis 20 scans/hr per token
//   7. scanQr                — controller: crypto → cache → DB → respond
//
// MIDDLEWARE ORDER for redirect routes:
//   1. scanCors              — same CORS policy
//   2. csrfProtect           — prevent cross-origin trigger of calls/notifications
//   3. publicScanLimiter     — same IP rate limit (shared budget)
//   4. validateAll()         — token + contactId format validated
//   5. redirect controller   — decrypt phone → 302
//
// Redirect routes do NOT use perTokenScanLimit — they fire after the user
// has already seen a valid ACTIVE profile. IP-level limiting is sufficient.
// =============================================================================

import { Router } from 'express';
import cors from 'cors';
import { z } from 'zod';
import path from 'path';
import { fileURLToPath } from 'url';

import { scanQr } from './scan.controller.js';
import {
  callContact,
  whatsappContact,
  callSchool,
  callDoctor,
} from './scan.redirect.controller.js';

import { validateAll } from '#middleware/validate.middleware.js';
import {
  checkIpBlockedRedis,
  publicScanLimiter,
  perTokenScanLimit,
} from '#middleware/security/scan.middleware.js';
import { scanCodeSchema, scanCodeRegex } from './scan.validation.js';
import { extractIp } from '#shared/network/extractIp.js';
import { logger } from '#config/logger.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const router = Router();

// =============================================================================
// CORS — shared across all /s/* routes
// =============================================================================
const scanCors = cors({
  origin: false,
  methods: ['GET'],
});

// =============================================================================
// HTML SERVING MIDDLEWARE — Serves emergency.html to browser requests
// =============================================================================
const serveHtmlForBrowser = (req, res, next) => {
  const accept = req.headers.accept || '';
  const wantsHtml = accept.includes('text/html') || accept.includes('*/*');

  if (wantsHtml && !accept.includes('application/json')) {
    return res.sendFile('emergency.html', {
      root: path.join(__dirname, '../../../public'),
      headers: {
        'Cache-Control': 'no-store, no-cache, must-revalidate, private',
        'X-Content-Type-Options': 'nosniff',
        'X-Frame-Options': 'DENY',
        'Referrer-Policy': 'no-referrer',
      },
    });
  }
  next();
};

// =============================================================================
// CSRF PROTECTION — Prevents cross-origin triggering of call/notification endpoints
// =============================================================================
const csrfProtect = (req, res, next) => {
  const origin = req.headers.origin || '';
  const referer = req.headers.referer || '';
  const host = req.headers.host || '';

  // Allow same-origin requests (no origin or origin matches host)
  if (!origin || origin.includes(host)) {
    return next();
  }

  // Allow if referer is same origin
  if (referer && referer.includes(host)) {
    return next();
  }

  logger.warn(
    {
      ip: extractIp(req),
      origin,
      referer,
      path: req.path,
    },
    '[scan.routes] CSRF attempt blocked'
  );

  return res.status(403).json({ error: 'Forbidden' });
};

// =============================================================================
// REDIRECT ROUTE VALIDATION SCHEMAS
// =============================================================================

const tokenOnlySchema = z
  .object({
    token: z.string().regex(scanCodeRegex, 'Invalid token format'),
  })
  .strict();

const contactRedirectSchema = z
  .object({
    contactId: z.string().uuid('Invalid contact ID'),
    token: z.string().regex(scanCodeRegex, 'Invalid token format'),
  })
  .strict();

// =============================================================================
// REDIRECT ROUTES — declared BEFORE /:code wildcard
// =============================================================================

router.get(
  '/call/:contactId/:token',
  scanCors,
  csrfProtect,
  publicScanLimiter,
  validateAll({ params: contactRedirectSchema }),
  callContact
);

router.get(
  '/wa/:contactId/:token',
  scanCors,
  csrfProtect,
  publicScanLimiter,
  validateAll({ params: contactRedirectSchema }),
  whatsappContact
);

router.get(
  '/school-call/:token',
  scanCors,
  csrfProtect,
  publicScanLimiter,
  validateAll({ params: tokenOnlySchema }),
  callSchool
);

router.get(
  '/doctor-call/:token',
  scanCors,
  csrfProtect,
  publicScanLimiter,
  validateAll({ params: tokenOnlySchema }),
  callDoctor
);

// =============================================================================
// MAIN QR SCAN ROUTE — declared AFTER redirect routes
// =============================================================================
router.get(
  '/:code',
  scanCors,
  serveHtmlForBrowser,
  checkIpBlockedRedis,
  publicScanLimiter,
  validateAll({ params: scanCodeSchema }),
  perTokenScanLimit,
  scanQr
);

// Catch non-GET methods on any /s/* route
router.all('*splat', (_req, res) => {
  res.status(405).json({ error: 'Method not allowed' });
});

export default router;
