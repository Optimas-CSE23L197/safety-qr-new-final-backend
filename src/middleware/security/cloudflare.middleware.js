// =============================================================================
// cloudflare.middleware.js — RESQID
// Enforces that all traffic is routed through Cloudflare in production.
// Controlled by ENV.CLOUDFLARE_ONLY — set true in production.
// =============================================================================

import { ENV } from '#config/env.js';
import { logger } from '#config/logger.js';

/**
 * Cloudflare presence is verified by checking for the `CF-Ray` header.
 * This header is injected by Cloudflare on every proxied request and
 * cannot be spoofed from outside the Cloudflare network when your
 * DNS is orange-clouded (proxied).
 *
 * CF-Ray format: <16-hex-char-id>-<airport-code>  e.g. "7f3e1a2b3c4d5e6f-BOM"
 */
const CF_RAY_REGEX = /^[0-9a-f]{16}-[A-Z]{3}$/i;

export function cloudflareOnly(req, res, next) {
  // Bypass entirely in non-production or when flag is off
  if (!ENV.CLOUDFLARE_ONLY) return next();

  const cfRay = req.headers['cf-ray'];

  if (!cfRay || !CF_RAY_REGEX.test(cfRay)) {
    logger.warn(
      {
        ip: req.ip,
        requestId: req.id,
        cfRay: cfRay ?? 'missing',
        path: req.path,
      },
      'Blocked: request did not originate from Cloudflare'
    );

    return res.status(403).json({
      success: false,
      code: 'DIRECT_ACCESS_FORBIDDEN',
      message: 'Direct access to this server is not allowed.',
    });
  }

  // Optionally expose the CF-Ray on res.locals for logging/tracing
  res.locals.cfRay = cfRay;

  next();
}
