// app.js — Corrected imports

import express from 'express';
import { ENV } from './config/env.js';
import { logger } from './config/logger.js'; // Remove morganMiddleware import

// ── Middleware imports ─────────────────────────────────────────────────────
// helmet.middleware.js exports apiHelmet as default
import { apiHelmet as helmet } from './middleware/security/helmet.middleware.js';

// cors.middleware.js exports corsMiddleware as default
import { corsMiddleware as cors } from './middleware/security/cors.middleware';

import { requestId } from './middleware/requestId.middleware.js';
import { tenantScope } from './middleware/auth/tenantScope.middleware.js';
import { enforceContentType as contentType } from './middleware/contentType.middleware.js';
import { sanitizeNoSql as sanitize } from './middleware/sanitize.middleware.js';
import { sanitizeXss as xss } from './middleware/security/xss.middleware.js';
import { hppProtection as hpp } from './middleware/security/hpp.middleware.js';
import { enforceRequestSize as requestSize } from './middleware/security/requestSize.middleware.js';
import { apiLimiter as rateLimit } from './middleware/security/rateLimit.middleware.js';
import { apiSlowDown as slowDown } from './middleware/security/slowDown.middleware.js';
import { ipBlockMiddleware as ipBlock } from './middleware/security/ipBlock.middleware.js';
import { geoBlock } from './middleware/security/geoBlock.middleware.js';
import { maintenanceMode } from './middleware/maintenanceMode.middleware.js';
import { verifyDevice as deviceFingerprint } from './middleware/deviceFingerprint.middleware.js';
import { behavioralSecurity } from './middleware/security/behavioralSecurity.middleware.js';
import { attackLogger } from './middleware/logging/attackLogger.middleware.js';
import { auditLog } from './middleware/logging/auditLog.middleware.js';
import { apiVersion } from './middleware/apiVersion.middleware.js';
import { httpLogger } from './middleware/logging/httpLogger.middleware.js'; // Import httpLogger directly
import { globalErrorHandler as errorHandler } from './middleware/error.middleware.js';

// ── Route imports ──────────────────────────────────────────────────────────
import routes from './routes/index.js';

// ── Health / monitoring ────────────────────────────────────────────────────
import { healthRouter } from './monitoring/health.js';

// ── Banner ─────────────────────────────────────────────────────────────────
const MIDDLEWARE_REGISTRY = [
  { name: 'request-id', desc: 'Attaches X-Request-ID to every request' },
  { name: 'helmet', desc: 'Security headers (CSP, HSTS, XSS…)' },
  { name: 'cors', desc: 'CORS policy enforcement' },
  { name: 'content-type', desc: 'Enforces application/json on writes' },
  { name: 'request-size', desc: 'Per-route body size limits' },
  { name: 'ip-block', desc: 'Blocked IP list from Redis' },
  { name: 'geo-block', desc: 'Country-level geo restrictions' },
  { name: 'maintenance-mode', desc: 'Toggleable via Redis flag' },
  { name: 'rate-limit', desc: 'API rate limiting' },
  { name: 'slow-down', desc: 'Progressive delay before rate limit' },
  { name: 'hpp', desc: 'HTTP param pollution protection' },
  { name: 'sanitize', desc: 'Input sanitization (NoSQL injection)' },
  { name: 'xss', desc: 'XSS payload stripping' },
  { name: 'device-fingerprint', desc: 'Device ID validation' },
  { name: 'behavioral-security', desc: 'Request pattern analysis' },
  { name: 'attack-logger', desc: 'Logs suspicious requests to audit log' },
  { name: 'http-logger', desc: 'HTTP access log' },
  { name: 'api-version', desc: 'Attaches req.apiVersion from URL prefix' },
  { name: 'tenant-scope', desc: 'Attaches req.schoolId from JWT' },
  { name: 'audit-log', desc: 'Mutation audit trail → DB' },
];

export function printMiddlewareTable() {
  const c = {
    reset: '\x1b[0m',
    bold: '\x1b[1m',
    dim: '\x1b[2m',
    cyan: '\x1b[36m',
    green: '\x1b[32m',
    yellow: '\x1b[33m',
    gray: '\x1b[90m',
  };

  const pad = (s, n) => String(s).padEnd(n);
  const w1 = 22,
    w2 = 46;
  const line = `${c.gray}  ${'─'.repeat(w1 + w2 + 5)}${c.reset}`;

  console.log(`\n${line}`);
  console.log(
    `  ${c.bold}${c.cyan}Active Middleware${c.reset}  ${c.dim}(registration order)${c.reset}`
  );
  console.log(line);

  MIDDLEWARE_REGISTRY.forEach(({ name, desc }, i) => {
    const num = c.gray + String(i + 1).padStart(2) + c.reset;
    const dot = c.green + '●' + c.reset;
    console.log(`  ${num} ${dot} ${c.bold}${pad(name, w1)}${c.reset}${c.dim}${desc}${c.reset}`);
  });

  console.log(`${line}\n`);
}

// ── App factory ────────────────────────────────────────────────────────────
export function createApp() {
  const app = express();

  // ── Trust proxy (Railway / Render / Heroku put a load balancer in front) ─
  app.set('trust proxy', 1);
  app.disable('x-powered-by');

  // ── Core body parsing ──────────────────────────────────────────────────
  app.use(express.json({ limit: ENV.MAX_BODY_SIZE ?? '1mb' }));
  app.use(express.urlencoded({ extended: true, limit: ENV.MAX_BODY_SIZE ?? '1mb' }));

  // ── Middleware stack (order matters) ───────────────────────────────────
  app.use(requestId); // 1. ID first — everything else can log it
  app.use(helmet); // 2. Security headers
  app.use(cors); // 3. CORS
  app.use(contentType); // 4. Content-type guard before reading body
  app.use(requestSize); // 5. Body size limit
  app.use(ipBlock); // 6. IP blocklist (fast reject)
  app.use(geoBlock); // 7. Geo block (fast reject)
  app.use(maintenanceMode); // 8. Maintenance flag
  app.use(rateLimit); // 9. Rate limit
  app.use(slowDown); // 10. Slow down before hard limit
  app.use(hpp); // 11. Param pollution
  app.use(sanitize); // 12. Input sanitize
  app.use(xss); // 13. XSS strip
  app.use(deviceFingerprint); // 14. Device ID
  app.use(behavioralSecurity); // 15. Behavioral analysis
  app.use(attackLogger); // 16. Attack logging
  app.use(httpLogger); // 17. HTTP access log (was morganMiddleware)
  app.use(apiVersion); // 18. API version from URL
  app.use(tenantScope); // 19. Tenant scope from JWT (after auth on routes)
  app.use(auditLog); // 20. Audit trail

  // ── Health checks (no auth, no rate limit) ────────────────────────────
  app.use('/health', healthRouter);

  // ── API routes ─────────────────────────────────────────────────────────
  app.use('/api', routes);

  // ── 404 handler ────────────────────────────────────────────────────────
  app.use((req, res) => {
    res.status(404).json({
      success: false,
      error: 'NOT_FOUND',
      message: `Cannot ${req.method} ${req.originalUrl}`,
      requestId: req.id,
    });
  });

  // ── Global error handler (must be last) ───────────────────────────────
  app.use(errorHandler);

  return app;
}
