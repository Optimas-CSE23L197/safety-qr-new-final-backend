// =============================================================================
// validation.js — RESQID
// Additional validation, monitoring, and safety checks
// Complements existing config files without modifying them
//
// This file provides:
//   - Runtime config validation
//   - Connection pool monitoring
//   - Health check enhancements
//   - Additional constants used across the app
// =============================================================================

import { ENV } from './env.js';
import { logger } from './logger.js';
import { prisma } from './prisma.js';
import { redis, middlewareRedis, workerRedis } from './redis.js';

// ─── Additional Constants (not in constants.js) ─────────────────────────────

export const ADDITIONAL_CONSTANTS = Object.freeze({
  // Webhook retry configuration
  WEBHOOK: {
    MAX_RETRIES: 3,
    RETRY_DELAYS_MS: [1000, 5000, 15000],
    TIMEOUT_MS: 10000,
    CONCURRENT_LIMIT: 10,
  },

  // Rate limit headers
  RATE_LIMIT_HEADERS: {
    LIMIT: 'x-rate-limit-limit',
    REMAINING: 'x-rate-limit-remaining',
    RESET: 'x-rate-limit-reset',
    RETRY_AFTER: 'retry-after',
  },

  // Cache control
  CACHE: {
    DEFAULT_TTL_SECS: 300, // 5 minutes
    STATIC_TTL_SECS: 86400, // 24 hours
    NO_CACHE: 'no-cache, no-store, must-revalidate',
  },

  // CORS configuration defaults
  CORS: {
    ALLOWED_METHODS: ['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'OPTIONS'],
    ALLOWED_HEADERS: [
      'Content-Type',
      'Authorization',
      'X-CSRF-Token',
      'X-Request-ID',
      'API-Version',
      'X-Device-ID',
    ],
    EXPOSED_HEADERS: ['X-Request-ID', 'X-Rate-Limit-Remaining'],
    MAX_AGE: 86400, // 24 hours
  },
});

// ─── Runtime Configuration Validator ────────────────────────────────────────

/**
 * validateRuntimeConfig()
 * Performs runtime checks to ensure all services are properly configured
 * Call this once at application startup after all modules are loaded
 */
export async function validateRuntimeConfig() {
  const errors = [];
  const warnings = [];

  // 1. Validate Redis connectivity with all clients
  try {
    const httpPing = await Promise.race([
      redis.ping(),
      new Promise((_, reject) => setTimeout(() => reject(new Error('Timeout')), 2000)),
    ]);
    if (httpPing !== 'PONG') errors.push('Redis HTTP client: unexpected response');
  } catch (err) {
    errors.push(`Redis HTTP client: ${err.message}`);
  }

  try {
    const middlewarePing = await middlewareRedis.ping();
    if (middlewarePing !== 'PONG') warnings.push('Redis middleware client: unexpected response');
  } catch (err) {
    warnings.push(`Redis middleware client: ${err.message}`);
  }

  try {
    const workerPing = await workerRedis.ping();
    if (workerPing !== 'PONG') warnings.push('Redis worker client: unexpected response');
  } catch (err) {
    warnings.push(`Redis worker client: ${err.message}`);
  }

  // 2. Validate storage accessibility (via infrastructure module)
  try {
    const { getStorage } = await import('#infrastructure/storage/storage.index.js');
    const storage = getStorage();
    if (storage) {
      // Just check storage is initialized — actual bucket check happens on first upload
      warnings.push('Storage initialized — bucket accessibility checked on first upload');
    }
  } catch (err) {
    warnings.push(`Storage initialization: ${err.message}`);
  }

  // 3. Validate database connectivity
  try {
    await prisma.$queryRaw`SELECT 1`;
  } catch (err) {
    errors.push(`Database: ${err.message}`);
  }

  // 4. Check for duplicate secrets
  const allSecrets = [
    ENV.JWT_ACCESS_SECRET,
    ENV.JWT_REFRESH_SECRET,
    ENV.CSRF_SECRET,
    ENV.TOKEN_HASH_SECRET,
    ENV.SCAN_CODE_SECRET,
    ENV.LOOKUP_HASH_SECRET,
  ].filter(Boolean);

  const uniqueSecrets = new Set(allSecrets);
  if (uniqueSecrets.size !== allSecrets.length) {
    warnings.push('Multiple secrets have identical values - this reduces security');
  }

  // 5. Validate URL formats
  const urls = [
    { key: 'API_URL', value: ENV.API_URL },
    { key: 'SUPER_ADMIN_URL', value: ENV.SUPER_ADMIN_URL },
    { key: 'SCHOOL_ADMIN_URL', value: ENV.SCHOOL_ADMIN_URL },
    { key: 'SCAN_BASE_URL', value: ENV.SCAN_BASE_URL },
  ];

  for (const { key, value } of urls) {
    if (value && !value.startsWith('http://') && !value.startsWith('https://')) {
      warnings.push(`${key} should use HTTPS in production (current: ${value})`);
    }
  }

  // 6. Check for development defaults in production
  if (ENV.IS_PROD) {
    if (ENV.JWT_ACCESS_EXPIRY === '15m') {
      warnings.push('Using default JWT_ACCESS_EXPIRY (15m) - consider customizing');
    }

    if (!ENV.SENTRY_DSN) {
      warnings.push('SENTRY_DSN not configured - error monitoring unavailable');
    }

    if (!ENV.SLACK_ALERTS_WEBHOOK) {
      warnings.push('SLACK_ALERTS_WEBHOOK not configured - DLQ alerts disabled');
    }
  }

  // 7. Worker config validation
  if (ENV.ENABLE_PIPELINE_QUEUE && ENV.IS_PROD) {
    warnings.push('ENABLE_PIPELINE_QUEUE=true in production — pipeline worker should run locally');
  }

  // Log results
  if (errors.length > 0) {
    logger.error(
      { type: 'runtime_config_errors', errors },
      `Runtime validation failed with ${errors.length} error(s)`
    );
    return { valid: false, errors, warnings };
  }

  if (warnings.length > 0) {
    logger.warn(
      { type: 'runtime_config_warnings', warnings },
      `Runtime validation completed with ${warnings.length} warning(s)`
    );
  } else {
    logger.info({ type: 'runtime_config_valid' }, 'Runtime configuration validated successfully');
  }

  return { valid: true, errors: [], warnings };
}

// ─── Connection Pool Monitor ─────────────────────────────────────────────────

let monitoringInterval = null;
let lastStats = {};

/**
 * startConnectionMonitoring()
 * Starts periodic monitoring of connection pools
 * Detects connection leaks and unusual patterns
 */
export function startConnectionMonitoring(intervalMs = 60000) {
  if (monitoringInterval) {
    clearInterval(monitoringInterval);
  }

  monitoringInterval = setInterval(async () => {
    try {
      const stats = await getConnectionStats();
      detectAnomalies(stats);
      lastStats = stats;
    } catch (err) {
      // Silent fail for monitoring - don"t spam logs
      if (process.env.NODE_ENV !== 'production') {
        logger.debug({ err: err.message }, 'Connection monitoring error');
      }
    }
  }, intervalMs);

  logger.info({ intervalMs }, 'Connection monitoring started');
}

/**
 * stopConnectionMonitoring()
 * Stops the monitoring interval
 */
export function stopConnectionMonitoring() {
  if (monitoringInterval) {
    clearInterval(monitoringInterval);
    monitoringInterval = null;
    logger.info('Connection monitoring stopped');
  }
}

/**
 * getConnectionStats()
 * Collects current connection statistics from all services
 */
async function getConnectionStats() {
  const stats = {
    timestamp: new Date().toISOString(),
    redis: {},
    database: {},
    memory: {},
  };

  // Redis stats
  try {
    const redisInfo = await redis.info('clients');
    const connectedClients = redisInfo.match(/connected_clients:(\d+)/);
    if (connectedClients) {
      stats.redis.connected_clients = parseInt(connectedClients[1]);
    }
    stats.redis.status = redis.status;
  } catch (err) {
    stats.redis.error = err.message;
  }

  // Database connection pool stats (Prisma doesn"t expose pool stats directly)
  try {
    // Execute a quick query to test connection
    const start = Date.now();
    await prisma.$queryRaw`SELECT 1`;
    stats.database.query_latency_ms = Date.now() - start;
    stats.database.status = 'ok';
  } catch (err) {
    stats.database.error = err.message;
    stats.database.status = 'error';
  }

  // Memory usage
  stats.memory = {
    rss_mb: Math.round(process.memoryUsage().rss / 1024 / 1024),
    heap_total_mb: Math.round(process.memoryUsage().heapTotal / 1024 / 1024),
    heap_used_mb: Math.round(process.memoryUsage().heapUsed / 1024 / 1024),
    external_mb: Math.round(process.memoryUsage().external / 1024 / 1024),
  };

  return stats;
}

/**
 * detectAnomalies()
 * Compares current stats with previous to detect leaks or issues
 */
function detectAnomalies(currentStats) {
  const warnings = [];

  // Check for Redis connection leak
  if (lastStats.redis?.connected_clients && currentStats.redis.connected_clients) {
    const increase = currentStats.redis.connected_clients - lastStats.redis.connected_clients;
    if (increase > 50 && currentStats.redis.connected_clients > 200) {
      warnings.push(
        `Redis connections increased by ${increase} (now: ${currentStats.redis.connected_clients})`
      );
    }
  }

  // Check for memory leak
  if (lastStats.memory?.heap_used_mb && currentStats.memory?.heap_used_mb) {
    const increaseMb = currentStats.memory.heap_used_mb - lastStats.memory.heap_used_mb;
    const increasePercent = (increaseMb / lastStats.memory.heap_used_mb) * 100;

    if (increasePercent > 20 && increaseMb > 100) {
      warnings.push(`Heap memory increased by ${increasePercent.toFixed(1)}% (${increaseMb}MB)`);
    }
  }

  // Log warnings
  if (warnings.length > 0) {
    logger.warn(
      { type: 'connection_anomaly', warnings, stats: currentStats },
      'Connection pool anomalies detected'
    );
  }
}

// ─── Health Check Enhancement ────────────────────────────────────────────────

/**
 * enhancedHealthCheck()
 * Comprehensive health check for load balancers and monitoring
 * Returns detailed status of all dependencies
 */
export async function enhancedHealthCheck() {
  const start = Date.now();
  const checks = {
    status: 'ok',
    timestamp: new Date().toISOString(),
    uptime_seconds: process.uptime(),
    services: {},
  };

  // Check database
  try {
    const dbStart = Date.now();
    await prisma.$queryRaw`SELECT 1`;
    checks.services.database = {
      status: 'ok',
      latency_ms: Date.now() - dbStart,
    };
  } catch (err) {
    checks.services.database = {
      status: 'error',
      error: err.message,
    };
    checks.status = 'degraded';
  }

  // Check Redis (using all clients)
  const redisClients = [
    { name: 'http', client: redis },
    { name: 'middleware', client: middlewareRedis },
    { name: 'worker', client: workerRedis },
  ];

  for (const { name, client } of redisClients) {
    try {
      const redisStart = Date.now();
      await client.ping();
      checks.services[`redis_${name}`] = {
        status: 'ok',
        latency_ms: Date.now() - redisStart,
      };
    } catch (err) {
      checks.services[`redis_${name}`] = {
        status: 'error',
        error: err.message,
      };
      checks.status = 'degraded';
    }
  }

  // Check S3
  try {
    const s3Start = Date.now();
    const { checkS3Health } = await import('./s3.js');
    const s3Health = await checkS3Health();
    checks.services.s3 = {
      status: s3Health.status,
      latency_ms: Date.now() - s3Start,
      ...(s3Health.error && { error: s3Health.error }),
    };
    if (s3Health.status !== 'ok') checks.status = 'degraded';
  } catch (err) {
    checks.services.s3 = { status: 'error', error: err.message };
    checks.status = 'degraded';
  }

  // Overall health
  checks.response_time_ms = Date.now() - start;
  checks.healthy = checks.status === 'ok';

  return checks;
}

// ─── Graceful Shutdown Enhancement ──────────────────────────────────────────

let isShuttingDown = false;

/**
 * enhancedGracefulShutdown()
 * Performs a complete graceful shutdown with timeout
 * Call this in your shutdown handlers
 */
export async function enhancedGracefulShutdown(signal) {
  if (isShuttingDown) {
    logger.warn('Shutdown already in progress, forcing exit...');
    process.exit(1);
  }
  isShuttingDown = true;

  const timeout = setTimeout(() => {
    logger.error('Graceful shutdown timeout (30s), forcing exit');
    process.exit(1);
  }, 30000);

  try {
    logger.info({ signal }, 'Starting graceful shutdown');

    // Stop accepting new connections (if using a server with this capability)
    // This depends on your server implementation

    // Stop monitoring
    stopConnectionMonitoring();

    // Close database connections
    const { disconnectPrisma } = await import('./prisma.js');
    await disconnectPrisma();

    // Close Redis connections
    const { disconnectRedis } = await import('./redis.js');
    await disconnectRedis();

    // Close mailer if open
    const { closeMailer } = await import('./mailer.js');
    closeMailer();

    logger.info('Graceful shutdown completed');
    clearTimeout(timeout);
    process.exit(0);
  } catch (err) {
    logger.error({ err: err.message }, 'Error during graceful shutdown');
    clearTimeout(timeout);
    process.exit(1);
  }
}

// ─── Startup Banner ─────────────────────────────────────────────────────────

/**
 * printStartupBanner()
 * Prints a beautiful startup banner with configuration summary
 */
export function printStartupBanner() {
  const mode = ENV.IS_PROD ? '🚀 PRODUCTION' : ENV.IS_DEV ? '🔧 DEVELOPMENT' : '🧪 STAGING';

  console.log('\n' + '='.repeat(70));
  console.log(`  RESQID API Server - ${mode}`);
  console.log('='.repeat(70));
  console.log(`  📡 Port:          ${ENV.PORT}`);
  console.log(
    `  🗄️  Database:      ${ENV.DATABASE_URL?.split('@')[1]?.split('/')[0] || 'configured'}`
  );
  console.log(
    `  🔄 Redis:         ${ENV.REDIS_URL?.split('@')[1]?.split('/')[0] || ENV.REDIS_SENTINEL ? 'sentinel' : ENV.REDIS_CLUSTER ? 'cluster' : 'single'}`
  );
  console.log(`  📦 S3 Bucket:     ${ENV.AWS_S3_BUCKET || 'not configured'}`);
  console.log(`  📧 SMTP:          ${ENV.SMTP_HOST || 'not configured (dev mode)'}`);
  console.log(`  📱 Firebase:      ${ENV.FIREBASE_PROJECT_ID ? 'configured' : 'not configured'}`);
  console.log(`  💳 Razorpay:      ${ENV.RAZORPAY_KEY_ID ? 'configured' : 'not configured'}`);
  console.log(`  🔐 JWT:           ${ENV.JWT_ACCESS_EXPIRY} / ${ENV.JWT_REFRESH_EXPIRY}`);
  console.log(`  📝 Log Level:     ${ENV.LOG_LEVEL} (${ENV.LOG_FORMAT})`);
  console.log(`  🌍 Environment:   ${ENV.NODE_ENV}`);
  console.log('='.repeat(70) + '\n');
}
