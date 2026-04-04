// =============================================================================
// app.js — RESQID
// STRICT MODE — Production-ready Express application
// Middleware order is CRITICAL — do not reorder without understanding dependencies
// =============================================================================

import express from 'express';
import { ENV } from '#config/env.js';
import { logger } from '#config/logger.js';
import cookieParser from 'cookie-parser'; // ✅ Already imported

// ── Security Middleware (NO PARSING BEFORE THESE) ─────────────────────────────
import { requestId } from '#middleware/requestId.middleware.js';
import { maintenanceMode } from '#middleware/maintenanceMode.middleware.js';
import { apiVersion } from '#middleware/apiVersion.middleware.js';
import { apiHelmet as helmet } from '#middleware/security/helmet.middleware.js';
import { corsMiddleware as cors } from '#middleware/security/cors.middleware.js';
import { enforceContentType as contentType } from '#middleware/contentType.middleware.js';
import { enforceRequestSize as requestSize } from '#middleware/security/requestSize.middleware.js';
import { ipBlockMiddleware as ipBlock } from '#middleware/security/ipBlock.middleware.js';
import { geoBlock } from '#middleware/security/geoBlock.middleware.js';

// ── Rate Limiting & Attack Prevention ─────────────────────────────────────────
import { apiLimiter as rateLimit } from '#middleware/security/rateLimit.middleware.js';
import { apiSlowDown as slowDown } from '#middleware/security/slowDown.middleware.js';
import { hppProtection as hpp } from '#middleware/security/hpp.middleware.js';
import { sanitizeNoSql as sanitize } from '#middleware/sanitize.middleware.js';
import { sanitizeXss as xss } from '#middleware/security/xss.middleware.js';
import { behavioralSecurity } from '#middleware/security/behavioralSecurity.middleware.js';
import { attackLogger } from '#middleware/logging/attackLogger.middleware.js';

// ── Body Parsing (AFTER security checks) ──────────────────────────────────────
import { httpLogger } from '#middleware/logging/httpLogger.middleware.js';

// ── Authentication & Authorization (AFTER body parsing) ───────────────────────
import { authenticate } from '#middleware/auth/auth.middleware.js';
import { tenantScope } from '#middleware/auth/tenantScope.middleware.js';
import { verifyDevice } from '#middleware/deviceFingerprint.middleware.js';
import { auditLog } from '#middleware/logging/auditLog.middleware.js';

// ── Routes ────────────────────────────────────────────────────────────────────
import routes from './routes/index.js';
import bullBoardRouter from './routes/bullMQ.routes.js';
import { healthRouter } from '#monitoring/health.js';
import scanRoutes from '#modules/scan/scan.routes.js';

// ── Error Handling (MUST BE LAST) ────────────────────────────────────────────
import { globalErrorHandler, notFoundHandler } from '#middleware/error.middleware.js';

// =============================================================================
// MIDDLEWARE REGISTRY (for debugging only)
// =============================================================================
const MIDDLEWARE_ORDER = [
  { priority: 1, name: 'requestId', desc: 'Request ID generation' },
  { priority: 2, name: 'maintenanceMode', desc: 'Global maintenance gate' },
  { priority: 3, name: 'apiVersion', desc: 'API version detection' },
  { priority: 4, name: 'helmet', desc: 'Security headers (CSP, HSTS)' },
  { priority: 5, name: 'cors', desc: 'CORS policy' },
  { priority: 6, name: 'contentType', desc: 'JSON content-type enforcement' },
  { priority: 7, name: 'requestSize', desc: 'Body size limits' },
  { priority: 8, name: 'ipBlock', desc: 'IP blocklist (Redis)' },
  { priority: 9, name: 'geoBlock', desc: 'Geo-restriction (India only)' },
  { priority: 10, name: 'rateLimit', desc: 'Rate limiting' },
  { priority: 11, name: 'slowDown', desc: 'Progressive delay' },
  { priority: 12, name: 'hpp', desc: 'HTTP param pollution' },
  { priority: 13, name: 'sanitize', desc: 'NoSQL injection prevention' },
  { priority: 14, name: 'xss', desc: 'XSS payload stripping' },
  { priority: 15, name: 'behavioralSecurity', desc: 'Behavioral scoring' },
  { priority: 16, name: 'attackLogger', desc: 'Attack pattern detection' },
  { priority: 17, name: 'httpLogger', desc: 'HTTP access log' },
  { priority: 18, name: 'bodyParser', desc: 'Express JSON parser' },
  { priority: 19, name: 'cookieParser', desc: 'Cookie parsing' }, // ✅ Added
  { priority: 20, name: 'authenticate', desc: 'JWT verification' },
  { priority: 21, name: 'tenantScope', desc: 'School ID injection' },
  { priority: 22, name: 'deviceFingerprint', desc: 'Device validation' },
  { priority: 23, name: 'auditLog', desc: 'Mutation audit trail' },
];

export function printMiddlewareTable() {
  const c = {
    reset: '\x1b[0m',
    bold: '\x1b[1m',
    dim: '\x1b[2m',
    cyan: '\x1b[36m',
    green: '\x1b[32m',
    gray: '\x1b[90m',
  };

  console.log(`\n${c.gray}  ${'─'.repeat(70)}${c.reset}`);
  console.log(
    `  ${c.bold}${c.cyan}Middleware Execution Order${c.reset}  ${c.dim}(STRICT MODE)${c.reset}`
  );
  console.log(`${c.gray}  ${'─'.repeat(70)}${c.reset}`);

  MIDDLEWARE_ORDER.forEach(({ priority, name, desc }) => {
    const num = `${c.gray}${String(priority).padStart(2)}${c.reset}`;
    const dot = `${c.green}●${c.reset}`;
    console.log(
      `  ${num}  ${dot}  ${c.bold}${name.padEnd(20)}${c.reset}  ${c.dim}${desc}${c.reset}`
    );
  });

  console.log(`${c.gray}  ${'─'.repeat(70)}${c.reset}\n`);
}

// =============================================================================
// APP FACTORY
// =============================================================================
export function createApp() {
  const app = express();

  // ── Trust Proxy (Railway/Cloudflare) ───────────────────────────────────────
  app.set('trust proxy', ENV.TRUST_PROXY ?? 1);
  app.disable('x-powered-by');

  // ════════════════════════════════════════════════════════════════════════════
  // LAYER 1: REQUEST ID & MAINTENANCE (Must be FIRST)
  // ════════════════════════════════════════════════════════════════════════════
  app.use(requestId); // 1. Request ID for tracing
  app.use(maintenanceMode); // 2. Maintenance gate (before everything)
  app.use(apiVersion); // 3. API version detection

  // ════════════════════════════════════════════════════════════════════════════
  // LAYER 2: SECURITY HEADERS & CORS (Before any request processing)
  // ════════════════════════════════════════════════════════════════════════════
  app.use(helmet); // 4. Security headers (CSP, HSTS)
  app.use(cors); // 5. CORS policy

  // ════════════════════════════════════════════════════════════════════════════
  // LAYER 3: REQUEST VALIDATION (Before body parsing)
  // ════════════════════════════════════════════════════════════════════════════
  app.use(contentType); // 6. Content-type enforcement
  app.use(requestSize); // 7. Body size limits

  // ════════════════════════════════════════════════════════════════════════════
  // LAYER 4: IP & GEO BLOCKING (Fast rejection)
  // ════════════════════════════════════════════════════════════════════════════
  app.use(ipBlock); // 8. IP blocklist check
  app.use(geoBlock); // 9. Geo-restriction

  // ════════════════════════════════════════════════════════════════════════════
  // LAYER 5: RATE LIMITING & SLOW DOWN (Traffic shaping)
  // ════════════════════════════════════════════════════════════════════════════
  app.use(rateLimit); // 10. Hard rate limits
  app.use(slowDown); // 11. Progressive slowdown

  // ════════════════════════════════════════════════════════════════════════════
  // LAYER 6: INPUT SANITIZATION (Before body parsing)
  // ════════════════════════════════════════════════════════════════════════════
  app.use(hpp); // 12. HTTP param pollution
  app.use(sanitize); // 13. NoSQL injection
  app.use(xss); // 14. XSS stripping

  // ════════════════════════════════════════════════════════════════════════════
  // LAYER 7: BEHAVIORAL ANALYSIS & ATTACK LOGGING
  // ════════════════════════════════════════════════════════════════════════════
  app.use(behavioralSecurity); // 15. Behavioral scoring
  app.use(attackLogger); // 16. Attack pattern detection

  // ════════════════════════════════════════════════════════════════════════════
  // LAYER 8: BODY PARSING, COOKIE PARSING & HTTP LOGGING
  // ════════════════════════════════════════════════════════════════════════════
  app.use(express.json({ limit: ENV.MAX_BODY_SIZE ?? '1mb' })); // Parse JSON bodies
  app.use(express.urlencoded({ extended: true, limit: ENV.MAX_BODY_SIZE ?? '1mb' })); // Parse URL-encoded bodies
  app.use(cookieParser()); // ✅ ADD THIS — Parse cookies from Cookie header
  app.use(httpLogger); // 17. HTTP access log

  // ════════════════════════════════════════════════════════════════════════════
  // LAYER 9: AUTHENTICATION & AUTHORIZATION
  // ════════════════════════════════════════════════════════════════════════════
  app.use(authenticate); // 18. JWT verification
  app.use(tenantScope); // 19. School ID injection
  app.use(verifyDevice); // 20. Device fingerprint (mobile only)
  app.use(auditLog); // 21. Audit trail (after auth)

  // ════════════════════════════════════════════════════════════════════════════
  // LAYER 10: MONITORING & ADMIN
  // ════════════════════════════════════════════════════════════════════════════
  app.use('/health', healthRouter); // Health checks (no auth)
  app.use('/api/admin/queues', bullBoardRouter); // BullMQ dashboard

  // ════════════════════════════════════════════════════════════════════════════
  // LAYER 11: APPLICATION ROUTES
  // ════════════════════════════════════════════════════════════════════════════
  app.use('/s', scanRoutes);
  app.use('/api', routes);

  // ════════════════════════════════════════════════════════════════════════════
  // LAYER 12: 404 & ERROR HANDLING (MUST BE LAST)
  // ════════════════════════════════════════════════════════════════════════════
  app.use(notFoundHandler); // 404 handler
  app.use(globalErrorHandler); // Global error handler (last)

  return app;
}

// =============================================================================
// START SERVER
// =============================================================================
export function startServer() {
  const app = createApp();
  const server = app.listen(ENV.PORT, () => {
    printMiddlewareTable();
    logger.info(
      { port: ENV.PORT, env: ENV.NODE_ENV, pid: process.pid },
      `🚀 RESQID API server started`
    );
  });

  return { app, server };
}

// Auto-start if run directly
import { fileURLToPath } from 'url';
import { resolve } from 'path';

const __filename = fileURLToPath(import.meta.url);
const entrypoint = resolve(process.argv[1]);

if (resolve(__filename) === entrypoint) {
  startServer();
}
