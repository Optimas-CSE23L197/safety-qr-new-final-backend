// =============================================================================
// geoBlock.middleware.js — RESQID
//
// FIX [#18]: Integrated blockIpNow() from ipBlock.middleware.js so non-Indian
// IPs are not just rejected for the current request — they are also written to
// ScanRateLimit (DB) and cached in Redis. All subsequent requests from that IP
// are rejected at the ipBlock middleware fast path (O(1) Redis check) before
// they even reach geoBlock. This eliminates the repeated DB geo-lookup cost
// for persistent attackers probing dashboard routes from foreign IPs.
// Blocks non-Indian IP addresses on dashboard and admin routes
// India-only system — reduces attack surface significantly
//
// Why this matters:
//   RESQID is an India-only product (INR payments, DPDP Act compliance,
//   school_country defaults to "IN"). Dashboard routes (school admin +
//   super admin) should only be accessible from Indian IPs. This blocks
//   the majority of automated attacks, credential stuffing, and scraping
//   that originates from foreign IPs.
//
// Public routes (/api/emergency) are NOT geo-blocked — a foreign
// national visiting India might scan a QR code in an emergency.
// Mobile app routes (/api/parents, /api/auth) are also exempt —
// parents travelling abroad must still access the app.
//
// Implementation:
//   Uses IP geolocation via the X-Country-Code header set by the
//   reverse proxy / CDN (Cloudflare, AWS CloudFront, Nginx).
//   Falls back to a known Indian IP prefix list if header is absent.
//
// IMPORTANT: This only works correctly if you"re behind a reverse proxy
//   that sets X-Country-Code. Without that header, it falls back to the
//   lightweight prefix check. Configure Cloudflare"s "CF-IPCountry' header
//   or map it to X-Country-Code in your Nginx config.
// =============================================================================

import { ApiError } from '#utils/response/ApiError.js';
import { asyncHandler } from '#utils/response/asyncHandler.js';
import { extractIp } from '#utils/network/extractIp.js';
import { ENV } from '#config/env.js';
import { logger } from '#config/logger.js';
import { blockIpNow } from './ipBlock.middleware.js';

// ─── Config ───────────────────────────────────────────────────────────────────

// Headers that carry country code — checked in order
const COUNTRY_HEADERS = [
  'cf-ipcountry', // Cloudflare
  'x-country-code', // Generic / custom proxy
  'cloudfront-viewer-country', // AWS CloudFront
];

// Routes that are geo-blocked (dashboard only)
const GEO_BLOCKED_PREFIXES = ['/api/super-admin', '/api/school-admin'];

// Routes that are always allowed regardless of country
const GEO_EXEMPT_PREFIXES = [
  '/api/emergency', // public safety endpoint
  '/api/auth', // parents abroad must log in
  '/api/parents', // parents abroad must use app
  '/api/webhooks', // Razorpay servers are not IN
  '/health',
  '/api/health',
];

// Known Indian IP prefixes — lightweight fallback when no CDN country header
// This is NOT exhaustive — treat it as a best-effort fallback only.
// Comprehensive geo-blocking requires CDN-level country headers.
const INDIAN_IP_PREFIXES = [
  '1.6.',
  '1.7.',
  '1.22.',
  '1.23.', // BSNL
  '14.96.',
  '14.97.',
  '14.98.',
  '14.99.', // BSNL/Hathway
  '27.0.',
  '27.4.',
  '27.56.',
  '27.57.', // Airtel
  '36.255.', // Railtel
  '43.224.',
  '43.225.',
  '43.226.',
  '43.227.', // Tata/VSNL
  '49.32.',
  '49.33.',
  '49.34.',
  '49.35.', // Vodafone IN
  '59.88.',
  '59.89.',
  '59.90.',
  '59.91.', // BSNL
  '61.0.',
  '61.1.',
  '61.2.',
  '61.3.', // MTNL / VSNL
  '101.0.',
  '101.1.',
  '101.2.',
  '101.3.', // Tikona / Airtel
  '103.0.',
  '103.1.',
  '103.2.',
  '103.3.', // Various Indian ISPs
  '106.192.',
  '106.193.',
  '106.194.', // Airtel
  '110.224.',
  '110.225.',
  '110.226.', // Reliance
  '111.88.',
  '111.89.',
  '111.90.',
  '111.91.', // BSNL
  '115.240.',
  '115.241.',
  '115.242.', // BSNL
  '116.72.',
  '116.73.',
  '116.74.',
  '116.75.', // Airtel
  '117.192.',
  '117.193.',
  '117.194.', // BSNL
  '120.56.',
  '120.57.',
  '120.58.',
  '120.59.', // Hathway
  '122.160.',
  '122.161.',
  '122.162.', // Airtel
  '125.16.',
  '125.17.',
  '125.18.',
  '125.19.', // BSNL
  '157.32.',
  '157.33.',
  '157.34.',
  '157.35.', // BSNL
  '182.64.',
  '182.65.',
  '182.66.',
  '182.67.', // Tata Docomo
  '192.168.',
  '10.',
  '172.16.', // Private (LAN / dev)
  '127.', // Loopback (local dev)
];

// ─── Core Middleware ──────────────────────────────────────────────────────────

/**
 * geoBlock
 * Applied only to dashboard routes. Must run after requestId middleware.
 * In development mode, geo-blocking is skipped entirely.
 */
export const geoBlock = asyncHandler(async (req, _res, next) => {
  // Skip in development — local IPs won't pass country check
  if (ENV.NODE_ENV === 'development') return next();

  // Only block dashboard routes
  const isDashboardRoute = GEO_BLOCKED_PREFIXES.some(p => req.path.startsWith(p));
  if (!isDashboardRoute) return next();

  // Skip exempt routes
  if (GEO_EXEMPT_PREFIXES.some(p => req.path.startsWith(p))) return next();

  const country = extractCountry(req);
  const ip = extractIp(req);

  // If we have a definitive country header — enforce strictly
  if (country) {
    if (country.toUpperCase() !== 'IN') {
      logger.warn(
        { ip, country, path: req.path, requestId: req.id, type: 'geo_block' },
        'geoBlock: non-Indian IP blocked from dashboard'
      );
      // Persist block — future requests rejected at ipBlock middleware (Redis fast path)
      blockIpNow(ip, `GEO_BLOCK_${country}`).catch(() => {});
      throw ApiError.forbidden('Access to this service is restricted to India');
    }
    return next();
  }

  // No country header — fallback to IP prefix check
  const isIndianIp = INDIAN_IP_PREFIXES.some(prefix => ip.startsWith(prefix));

  if (!isIndianIp) {
    logger.warn(
      { ip, path: req.path, requestId: req.id, type: 'geo_block_prefix' },
      'geoBlock: unrecognized IP prefix blocked from dashboard (no CDN country header)'
    );
    // Persist block — future requests rejected at ipBlock middleware (Redis fast path)
    blockIpNow(ip, 'GEO_BLOCK_UNKNOWN_PREFIX').catch(() => {});
    throw ApiError.forbidden('Access to this service is restricted to India');
  }

  next();
});

// ─── Helpers ──────────────────────────────────────────────────────────────────

function extractCountry(req) {
  for (const header of COUNTRY_HEADERS) {
    const value = req.headers[header];
    if (value && value.trim().length === 2) {
      return value.trim().toUpperCase();
    }
  }
  return null;
}
