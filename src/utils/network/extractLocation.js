// =============================================================================
// extractLocation.js — RESQID
// IP-to-location for scan audit logs — DPDP Act 2023 compliant
// Legal basis: Legitimate Interest (emergency safety use case)
// Only city + country stored — no precise lat/lon from IP
//
// Provider: ip-api.com (free tier: 45 req/min) or ipinfo.io
// Falls back gracefully on timeout/failure — scan never blocked by geo failure
// =============================================================================

import { logger } from '#config/logger.js';
import { isPrivateIp } from './extractIp.js';
import { cacheAside, TTL, CacheKey } from './Cache/cache.js';

const GEO_API_URL = 'http://ip-api.com/json';
const GEO_TIMEOUT = 2000; // 2 second timeout — never slow down scan

// ─── Types ────────────────────────────────────────────────────────────────────

/**
 * @typedef {Object} GeoLocation
 * @property {string|null} city
 * @property {string|null} region
 * @property {string|null} country      - ISO 3166-1 alpha-2 (e.g. 'IN')
 * @property {string|null} countryName
 * @property {number|null} latitude     - Only if consent given
 * @property {number|null} longitude    - Only if consent given
 * @property {boolean}     isp_vpn      - True if known VPN/proxy
 */

// ─── Main ─────────────────────────────────────────────────────────────────────

/**
 * getLocationFromIp(ip)
 * Returns city + country from IP — cached 1 hour per IP
 * Never throws — returns null object on any failure
 *
 * @param {string} ip
 * @returns {Promise<GeoLocation>}
 */
export async function getLocationFromIp(ip) {
  const EMPTY = {
    city: null,
    region: null,
    country: null,
    countryName: null,
    latitude: null,
    longitude: null,
    isp_vpn: false,
  };

  if (!ip || ip === '0.0.0.0') return EMPTY;

  // Skip private/loopback IPs
  if (isPrivateIp(ip)) {
    return { ...EMPTY, city: 'Private Network' };
  }

  // Cache by IP — same IP scanned repeatedly hits cache, not API
  const cacheKey = `geo:${ip}`;

  try {
    return (
      (await cacheAside(cacheKey, TTL.LONG, async () => {
        return fetchGeoData(ip);
      })) ?? EMPTY
    );
  } catch (err) {
    logger.warn({ ip, err: err.message }, 'GeoIP lookup failed — proceeding without location');
    return EMPTY;
  }
}

// ─── Fetch ────────────────────────────────────────────────────────────────────

async function fetchGeoData(ip) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), GEO_TIMEOUT);

  try {
    const res = await fetch(
      `${GEO_API_URL}/${ip}?fields=status,city,regionName,country,countryCode,proxy,hosting,lat,lon`,
      {
        signal: controller.signal,
      }
    );

    if (!res.ok) return null;

    const data = await res.json();

    if (data.status !== 'success') return null;

    return {
      city: data.city ?? null,
      region: data.regionName ?? null,
      country: data.countryCode ?? null, // "IN"
      countryName: data.country ?? null, // 'India'
      latitude: null, // Never store from IP — no consent
      longitude: null, // Never store from IP — no consent
      isp_vpn: !!(data.proxy || data.hosting),
    };
  } catch (err) {
    if (err.name === 'AbortError') {
      logger.warn({ ip }, 'GeoIP request timed out after 2s');
    }
    return null;
  } finally {
    clearTimeout(timer);
  }
}

// ─── Anomaly Helpers ──────────────────────────────────────────────────────────

/**
 * isVpnOrProxy(ip)
 * Quick check if IP is a known VPN/proxy — for anomaly detection
 */
export async function isVpnOrProxy(ip) {
  const geo = await getLocationFromIp(ip);
  return geo?.isp_vpn === true;
}

/**
 * isSameCountry(ip1, ip2)
 * Check if two IPs are from same country — for multi-location anomaly
 */
export async function isSameCountry(ip1, ip2) {
  const [geo1, geo2] = await Promise.all([getLocationFromIp(ip1), getLocationFromIp(ip2)]);
  if (!geo1?.country || !geo2?.country) return null; // unknown
  return geo1.country === geo2.country;
}
