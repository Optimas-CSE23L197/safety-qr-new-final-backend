// =============================================================================
// extractIp.js — RESQID
// Extract real client IP from request — handles proxies, load balancers, Nginx
// Critical for: ScanLog, ScanRateLimit, anomaly detection, audit logs
//
// Trust order:
//   1. CF-Connecting-IP     (Cloudflare)
//   2. X-Real-IP            (Nginx proxy_pass)
//   3. X-Forwarded-For[0]  (standard proxy chain — first is original)
//   4. req.socket.remoteAddress (direct connection fallback)
// =============================================================================

const IPV4_REGEX = /^(\d{1,3}\.){3}\d{1,3}$/;
const IPV6_REGEX = /^[0-9a-fA-F:]+$/;

// Private/loopback ranges — never log these as real IPs
const PRIVATE_RANGES = [
  /^127\./,
  /^10\./,
  /^172\.(1[6-9]|2\d|3[01])\./,
  /^192\.168\./,
  /^::1$/,
  /^fc00:/i,
  /^fe80:/i,
];

/**
 * extractIp(req)
 * Returns the real client IP string
 * Returns '0.0.0.0' as fallback — never returns null/undefined
 * @param {import('express').Request} req
 * @returns {string}
 */
export function extractIp(req) {
  // 1. Cloudflare
  const cf = req.headers["cf-connecting-ip"];
  if (cf && isValidIp(cf)) return normalizeIp(cf);

  // 2. Nginx / custom reverse proxy
  const xReal = req.headers["x-real-ip"];
  if (xReal && isValidIp(xReal)) return normalizeIp(xReal);

  // 3. X-Forwarded-For — take FIRST IP (leftmost = original client)
  const xff = req.headers["x-forwarded-for"];
  if (xff) {
    const first = xff.split(",")[0]?.trim();
    if (first && isValidIp(first)) return normalizeIp(first);
  }

  // 4. Direct socket connection
  const socket = req.socket?.remoteAddress ?? req.connection?.remoteAddress;
  if (socket && isValidIp(socket)) return normalizeIp(socket);

  return "0.0.0.0";
}

/**
 * isPrivateIp(ip)
 * Returns true for loopback and private LAN addresses
 * Used to flag scan logs from school intranet (TrustedScanZone)
 */
export function isPrivateIp(ip) {
  return PRIVATE_RANGES.some((r) => r.test(ip));
}

/**
 * isValidIp(ip)
 * Validate IPv4 or IPv6 format
 */
export function isValidIp(ip) {
  if (!ip || typeof ip !== "string") return false;
  const trimmed = ip.trim();
  return IPV4_REGEX.test(trimmed) || IPV6_REGEX.test(trimmed);
}

/**
 * normalizeIp(ip)
 * Strip IPv6 wrapper from IPv4 addresses
 * "::ffff:192.168.1.1" → "192.168.1.1"
 */
export function normalizeIp(ip) {
  if (!ip) return "0.0.0.0";
  const cleaned = ip.trim();
  // Strip IPv6-mapped IPv4 prefix
  if (cleaned.startsWith("::ffff:")) {
    return cleaned.slice(7);
  }
  return cleaned;
}
