// =============================================================================
// attackLogger.middleware.js — RESQID
// Detects attack patterns in request body and logs them to:
//   - pino (immediate, structured log)
//   - AuditLog (persistent DB record — queryable from super admin dashboard)
//   - ScanRateLimit (tracks repeat offenders by IP — feeds ipBlock middleware)
//
// This middleware is DETECTION ONLY — it always calls next().
// Blocking is handled upstream by sanitize.middleware.js (rejects bad input)
// and ipBlock.middleware.js (rejects flagged IPs entirely).
//
// Position in stack: AFTER sanitizeDeep + sanitizeXss (step [15b] in app.js)
// Running after sanitize means we log what was ATTEMPTED even after cleaning.
// =============================================================================

import { prisma } from "../config/prisma.js";
import { logger } from "../config/logger.js";

// ─── Attack Signatures ────────────────────────────────────────────────────────

const ATTACK_PATTERNS = [
  { pattern: /<script[\s\S]*?>[\s\S]*?<\/script>/gi, type: "XSS_SCRIPT_TAG" },
  { pattern: /javascript\s*:/gi, type: "XSS_JS_PROTOCOL" },
  { pattern: /on\w+\s*=\s*["'`]/gi, type: "XSS_EVENT_HANDLER" },
  { pattern: /data\s*:\s*text\/html/gi, type: "XSS_DATA_URI" },
  { pattern: /\$where|\$gt|\$lt|\$ne|\$in|\$nin/gi, type: "NOSQL_INJECTION" },
  { pattern: /union\s+select/gi, type: "SQL_INJECTION_UNION" },
  { pattern: /drop\s+table/gi, type: "SQL_INJECTION_DROP" },
  { pattern: /insert\s+into/gi, type: "SQL_INJECTION_INSERT" },
  {
    pattern: /__proto__|constructor\s*\[|prototype\s*\[/gi,
    type: "PROTOTYPE_POLLUTION",
  },
  { pattern: /\.\.(\/|\\)/g, type: "PATH_TRAVERSAL" },
];

// ─── Scanner ──────────────────────────────────────────────────────────────────

function scanForAttacks(obj, depth = 0) {
  if (depth > 5) return null;

  if (typeof obj === "string") {
    for (const { pattern, type } of ATTACK_PATTERNS) {
      pattern.lastIndex = 0; // always reset — patterns use /g flag
      if (pattern.test(obj)) return type;
    }
    return null;
  }

  if (Array.isArray(obj)) {
    for (const item of obj) {
      const found = scanForAttacks(item, depth + 1);
      if (found) return found;
    }
    return null;
  }

  if (obj !== null && typeof obj === "object") {
    for (const val of Object.values(obj)) {
      const found = scanForAttacks(val, depth + 1);
      if (found) return found;
    }
  }

  return null;
}

// ─── Middleware ───────────────────────────────────────────────────────────────

export const attackLogger = (req, _res, next) => {
  // Only scan if there's a body — skip GET/HEAD/health endpoints
  if (!req.body || Object.keys(req.body).length === 0) return next();

  const attackType = scanForAttacks(req.body);

  if (attackType) {
    const ip = req.ip ?? "unknown";
    const ua = req.headers["user-agent"] ?? "unknown";

    // Immediate structured log — visible in pino output right away
    logger.warn(
      {
        type: "attack_detected",
        attackType,
        ip,
        path: req.path,
        method: req.method,
        requestId: req.id,
        ua,
      },
      `⚠️  Attack attempt: ${attackType} from ${ip}`,
    );

    // Persist to AuditLog — fire-and-forget, never block the request
    prisma.auditLog
      .create({
        data: {
          actor_id: ip,
          actor_type: "SYSTEM",
          action: `ATTACK_ATTEMPT_${attackType}`,
          entity: "Request",
          entity_id: req.id ?? "unknown",
          metadata: {
            attackType,
            ip,
            ua,
            path: req.path,
            method: req.method,
            // Truncate body to 500 chars — never store full payload
            body: JSON.stringify(req.body).slice(0, 500),
          },
          ip_address: ip,
          user_agent: ua,
        },
      })
      .catch((err) =>
        logger.error(
          { err, type: "attack_log_failed" },
          "Failed to write attack AuditLog",
        ),
      );

    // Upsert into ScanRateLimit — tracks repeat offenders
    // When block_count >= 5, ipBlock middleware will auto-block this IP
    prisma.scanRateLimit
      .upsert({
        where: {
          identifier_identifier_type: {
            identifier: ip,
            identifier_type: "IP",
          },
        },
        create: {
          identifier: ip,
          identifier_type: "IP",
          count: 1,
          block_count: 1,
          blocked_reason: attackType,
          last_hit: new Date(),
          window_start: new Date(),
        },
        update: {
          count: { increment: 1 },
          block_count: { increment: 1 },
          blocked_reason: attackType, // stores most recent attack type
          last_hit: new Date(),
        },
      })
      .catch((err) =>
        logger.error(
          { err, type: "scan_rate_limit_failed" },
          "Failed to update ScanRateLimit",
        ),
      );
  }

  // Always continue — this middleware only detects, never blocks
  next();
};
