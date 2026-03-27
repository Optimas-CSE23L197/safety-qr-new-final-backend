// =============================================================================
// userAgent.js — RESQID
// User agent parsing for scan logs and device tracking
// Used for: DeviceLoginLog, ScanLog anomaly detection
// No external library — keeps bundle small, handles RESQID's known cases
// =============================================================================

// ─── Platform Detection ───────────────────────────────────────────────────────

/**
 * parsePlatform(userAgent)
 * Detect iOS, Android, or Web
 * @returns {'IOS'|'ANDROID'|'WEB'}
 */
export function parsePlatform(userAgent) {
  if (!userAgent) return 'WEB';
  const ua = userAgent.toLowerCase();

  if (/iphone|ipad|ipod/.test(ua)) return 'IOS';
  if (/android/.test(ua)) return 'ANDROID';
  return 'WEB';
}

/**
 * parseDeviceName(userAgent)
 * Extract a human-readable device name from UA string
 * "Mozilla/5.0 (iPhone; CPU iPhone OS 17_2 like...)" → "iPhone (iOS 17.2)"
 */
export function parseDeviceName(userAgent) {
  if (!userAgent) return null;
  const ua = userAgent;

  // iPhone
  const iphoneMatch = ua.match(/iPhone.*?OS ([\d_]+)/);
  if (iphoneMatch) {
    return `iPhone (iOS ${iphoneMatch[1].replace(/_/g, '.')})`;
  }

  // iPad
  const ipadMatch = ua.match(/iPad.*?OS ([\d_]+)/);
  if (ipadMatch) {
    return `iPad (iPadOS ${ipadMatch[1].replace(/_/g, '.')})`;
  }

  // Android
  const androidMatch = ua.match(/Android ([\d.]+);?\s*([^;)]+)?/);
  if (androidMatch) {
    const version = androidMatch[1];
    const device = androidMatch[2]?.trim();
    return device ? `${device} (Android ${version})` : `Android ${version}`;
  }

  // Desktop browsers
  if (/windows/i.test(ua)) return 'Windows PC';
  if (/macintosh/i.test(ua)) return 'Mac';
  if (/linux/i.test(ua)) return 'Linux';

  return 'Unknown Device';
}

/**
 * parseOsVersion(userAgent)
 * Extract OS version string
 */
export function parseOsVersion(userAgent) {
  if (!userAgent) return null;

  const iosMatch = userAgent.match(/OS ([\d_]+) like Mac/);
  if (iosMatch) return iosMatch[1].replace(/_/g, '.');

  const androidMatch = userAgent.match(/Android ([\d.]+)/);
  if (androidMatch) return androidMatch[1];

  const windowsMatch = userAgent.match(/Windows NT ([\d.]+)/);
  if (windowsMatch) return `Windows NT ${windowsMatch[1]}`;

  return null;
}

/**
 * parseBrowserName(userAgent)
 * Detect browser — used in scan logs
 */
export function parseBrowserName(userAgent) {
  if (!userAgent) return null;
  const ua = userAgent.toLowerCase();

  if (/edg\//.test(ua)) return 'Edge';
  if (/chrome\//.test(ua)) return 'Chrome';
  if (/firefox\//.test(ua)) return 'Firefox';
  if (/safari\//.test(ua)) return 'Safari';
  if (/opera\//.test(ua)) return 'Opera';

  return 'Other';
}

/**
 * isBotUserAgent(userAgent)
 * Detect known bots, crawlers, and automated scanners
 * Used in scan anomaly detection — bot scans flag HONEYPOT_TRIGGERED
 */
export function isBotUserAgent(userAgent) {
  if (!userAgent) return true; // No UA = suspicious
  const ua = userAgent.toLowerCase();

  const botPatterns = [
    'bot',
    'crawler',
    'spider',
    'scraper',
    'headless',
    'python-requests',
    'go-http-client',
    'curl/',
    'wget/',
    'axios/',
    'httpclient',
    'okhttp',
    'java/',
    'libwww',
    'postman',
    'insomnia',
    'httpie',
    'node-fetch',
  ];

  return botPatterns.some(p => ua.includes(p));
}

/**
 * deviceFingerprint(req)
 * Non-PII fingerprint for scan deduplication
 * Used in ScanLog.device_hash — identifies device without storing personal data
 * Hash of: UA + Accept-Language + Accept-Encoding (stable across sessions)
 */
export function deviceFingerprint(req) {
  const components = [
    req.headers['user-agent'] ?? '',
    req.headers['accept-language'] ?? '',
    req.headers['accept-encoding'] ?? '',
    parsePlatform(req.headers['user-agent']),
  ].join('|');

  // Simple deterministic hash — not crypto-secure, just for dedup
  let hash = 0;
  for (let i = 0; i < components.length; i++) {
    const char = components.charCodeAt(i);
    hash = (hash << 5) - hash + char;
    hash |= 0; // Convert to 32bit int
  }
  return Math.abs(hash).toString(16).padStart(8, '0');
}

/**
 * parseUserAgentSummary(req)
 * All-in-one parser for DeviceLoginLog and ScanLog
 */
export function parseUserAgentSummary(req) {
  const ua = req.headers['user-agent'] ?? null;
  return {
    userAgent: ua,
    platform: parsePlatform(ua),
    deviceName: parseDeviceName(ua),
    osVersion: parseOsVersion(ua),
    browser: parseBrowserName(ua),
    isBot: isBotUserAgent(ua),
    fingerprint: deviceFingerprint(req),
  };
}
