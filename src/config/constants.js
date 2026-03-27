// =============================================================================
// constants.js — RESQID
// Single source of truth for all application-wide constants
// No magic numbers or magic strings anywhere else in the codebase
//
// Rules:
//   - Every constant here is used in at least one middleware or handler
//   - Grouped by domain — easy to find and update
//   - Time values are expressed in milliseconds unless suffixed otherwise
//   - All objects are frozen — no accidental mutation
// =============================================================================

// ─── Token & Authentication ───────────────────────────────────────────────────

export const AUTH = Object.freeze({
  // JWT
  ISSUER: 'resqid',
  AUDIENCE: 'resqid-api',
  ALGORITHM: 'HS256',

  // Blacklist Redis key prefix — auth.middleware.js
  BLACKLIST_PREFIX: 'blacklist:',

  // Session Redis cache key prefix — auth.middleware.js
  SESSION_PREFIX: 'session:',
  SESSION_CACHE_TTL_SECS: 60, // 1 minute

  // Bearer token regex — auth.middleware.js
  BEARER_REGEX: /^Bearer\s[\w-]+\.[\w-]+\.[\w-]+$/,
});

// ─── OTP ──────────────────────────────────────────────────────────────────────

export const OTP = Object.freeze({
  // OTP expiry — OtpLog.expires_at
  EXPIRY_MINUTES: 10,
  EXPIRY_MS: 10 * 60 * 1000,

  // Max verification attempts before OTP is invalidated — OtpLog.max_attempts
  MAX_ATTEMPTS: 5,

  // Rate limiting — rateLimit.middleware.js otpLimiter
  MAX_REQUESTS_PER_WINDOW: 3,
  WINDOW_MINUTES: 10,

  // Redis key prefix for OTP rate limiting
  RATE_KEY_PREFIX: 'rl:otp:',
});

// ─── Sessions ─────────────────────────────────────────────────────────────────

export const SESSION = Object.freeze({
  // How long a session stays active — Session.expires_at
  // Must match JWT_REFRESH_EXPIRY in .env
  DEFAULT_EXPIRY_DAYS: 30,
  DEFAULT_EXPIRY_MS: 30 * 24 * 60 * 60 * 1000,

  // Session revoke reasons — SessionRevokeReason enum
  REVOKE_REASONS: Object.freeze({
    NEW_DEVICE_LOGIN: 'NEW_DEVICE_LOGIN',
    MANUAL_LOGOUT: 'MANUAL_LOGOUT',
    SESSION_EXPIRED: 'SESSION_EXPIRED',
    ADMIN_REVOKED: 'ADMIN_REVOKED',
    PASSWORD_CHANGED: 'PASSWORD_CHANGED',
    PHONE_CHANGED: 'PHONE_CHANGED',
  }),
});

// ─── Device & Parent ──────────────────────────────────────────────────────────

export const DEVICE = Object.freeze({
  // Redis cache TTL for ParentDevice records — deviceFingerprint.middleware.js
  CACHE_TTL_SECS: 60,

  // Header name for device identification — deviceFingerprint.middleware.js
  HEADER: 'x-device-id',

  // Device logout reasons — DeviceLogoutReason enum
  LOGOUT_REASONS: Object.freeze({
    NEW_DEVICE_LOGIN: 'NEW_DEVICE_LOGIN',
    MANUAL_LOGOUT: 'MANUAL_LOGOUT',
    SESSION_EXPIRED: 'SESSION_EXPIRED',
    ADMIN_REVOKED: 'ADMIN_REVOKED',
    SUSPICIOUS_ACTIVITY: 'SUSPICIOUS_ACTIVITY',
  }),
});

// ─── Rate Limiting ────────────────────────────────────────────────────────────

export const RATE_LIMIT = Object.freeze({
  // Redis key prefixes — rateLimit.middleware.js
  PREFIX: Object.freeze({
    EMERGENCY: 'rl:emergency:',
    AUTH: 'rl:auth:',
    OTP: 'rl:otp:',
    API: 'rl:api:',
    UPLOAD: 'rl:upload:',
    DASHBOARD: 'rl:dashboard:',
    TOKEN_GEN: 'rl:token-gen:',
    TOKEN_SCAN: 'rl:token:',
  }),

  // Public emergency API — 10 req/min per IP
  EMERGENCY: Object.freeze({
    WINDOW_MS: 60 * 1000,
    MAX: 10,
  }),

  // Auth routes — 5 req/15min per IP
  AUTH: Object.freeze({
    WINDOW_MS: 15 * 60 * 1000,
    MAX: 5,
  }),

  // Authenticated API — 300 req/min per user
  API: Object.freeze({
    WINDOW_MS: 60 * 1000,
    MAX: 300,
  }),

  // Dashboard — 500 req/min per user
  DASHBOARD: Object.freeze({
    WINDOW_MS: 60 * 1000,
    MAX: 500,
  }),

  // File upload — 10 req/hour per user
  UPLOAD: Object.freeze({
    WINDOW_MS: 60 * 60 * 1000,
    MAX: 10,
  }),

  // Token generation — 5 req/hour per super admin
  TOKEN_GEN: Object.freeze({
    WINDOW_MS: 60 * 60 * 1000,
    MAX: 5,
  }),

  // Per-token scan limit — 20 scans/hour per token hash
  TOKEN_SCAN: Object.freeze({
    WINDOW_SECS: 60 * 60,
    MAX: 20,
  }),
});

// ─── Slow Down ────────────────────────────────────────────────────────────────

export const SLOW_DOWN = Object.freeze({
  // slowDown.middleware.js — Redis key prefixes
  PREFIX: Object.freeze({
    EMERGENCY: 'sd:emergency:',
    AUTH: 'sd:auth:',
    API: 'sd:api:',
  }),

  EMERGENCY: Object.freeze({
    WINDOW_MS: 60 * 1000,
    DELAY_AFTER: 5,
    DELAY_MS_PER_HIT: 500,
    MAX_DELAY_MS: 3000,
  }),

  AUTH: Object.freeze({
    WINDOW_MS: 15 * 60 * 1000,
    DELAY_AFTER: 3,
    DELAY_MS_PER_HIT: 1000,
    MAX_DELAY_MS: 10_000,
  }),
});

// ─── CSRF ─────────────────────────────────────────────────────────────────────

export const CSRF = Object.freeze({
  COOKIE_NAME: '__Host-csrf',
  HEADER_NAME: 'x-csrf-token',
  TOKEN_BYTES: 32,
  TOKEN_TTL_MS: 24 * 60 * 60 * 1000, // 24 hours

  // Methods that require CSRF validation
  PROTECTED_METHODS: Object.freeze(['POST', 'PUT', 'PATCH', 'DELETE']),

  // Routes exempt from CSRF — csrf.middleware.js
  EXEMPT_PREFIXES: Object.freeze(['/api/emergency', '/api/auth/otp']),
});

// ─── Tenant / School ──────────────────────────────────────────────────────────

export const TENANT = Object.freeze({
  // Redis cache TTL for school records — tenantScope.middleware.js
  SCHOOL_CACHE_TTL_SECS: 5 * 60,

  // Redis cache TTL for parent-child links — restrictionOwnSchool.middleware.js
  PARENT_CHILDREN_CACHE_TTL_SECS: 2 * 60,

  // Redis key prefixes
  PREFIX: Object.freeze({
    SCHOOL: 'school:',
    PARENT_CHILDREN: 'parent_children:',
  }),
});

// ─── IP & Geo Blocking ────────────────────────────────────────────────────────

export const IP = Object.freeze({
  // Redis key prefixes — ipReputation.middleware.js
  BLOCK_PREFIX: 'ip:blocked:',
  TRUST_PREFIX: 'ip:trusted:',

  // Cache TTLs
  BLOCK_CACHE_TTL_SECS: 5 * 60,
  TRUST_CACHE_TTL_SECS: 10 * 60,

  // ScanRateLimit identifier types — matches RateLimitIdentifierType enum
  IDENTIFIER_TYPES: Object.freeze({
    IP: 'IP',
    DEVICE: 'DEVICE',
    TOKEN: 'TOKEN',
  }),

  // Default IP block duration for violations — 1 hour
  DEFAULT_BLOCK_DURATION_MS: 60 * 60 * 1000,
});

// ─── Maintenance ──────────────────────────────────────────────────────────────

export const MAINTENANCE = Object.freeze({
  // Redis cache key — maintenanceMode.middleware.js
  FLAG_KEY: 'maintenance_mode',
  CACHE_KEY: 'flag:maintenance_mode',
  CACHE_TTL_SECS: 30,
  BYPASS_HEADER: 'x-maintenance-bypass',
  RETRY_AFTER_SECS: 900, // 15 minutes

  // Routes always allowed even during maintenance
  ALWAYS_ALLOWED: Object.freeze(['/health', '/api/health', '/api/status']),
});

// ─── Feature Flags ────────────────────────────────────────────────────────────

export const FEATURE_FLAGS = Object.freeze({
  MAINTENANCE_MODE: 'maintenance_mode',
  // Add new feature flag keys here as they're added to the FeatureFlag model
  LOCATION_TRACKING: 'location_tracking',
  ANOMALY_DETECTION: 'anomaly_detection',
  WEBHOOK_DELIVERY: 'webhook_delivery',
});

// ─── Audit Log ────────────────────────────────────────────────────────────────

export const AUDIT = Object.freeze({
  // ActorType enum values — auditLog.middleware.js
  ACTOR_TYPES: Object.freeze({
    SUPER_ADMIN: 'SUPER_ADMIN',
    SCHOOL_USER: 'SCHOOL_USER',
    PARENT_USER: 'PARENT_USER',
    SYSTEM: 'SYSTEM',
  }),

  // Action verbs mapped from HTTP methods
  ACTIONS: Object.freeze({
    POST: 'CREATE',
    PUT: 'UPDATE',
    PATCH: 'UPDATE',
    DELETE: 'DELETE',
  }),

  // Sensitive fields stripped before writing to AuditLog.new_value
  REDACTED_FIELDS: Object.freeze([
    'password',
    'password_hash',
    'otp',
    'otp_hash',
    'token_hash',
    'refresh_token',
    'dob_encrypted',
    'phone_encrypted',
    'doctor_phone_encrypted',
    'secret',
    'private_key',
  ]),
});

// ─── Scan & Emergency ─────────────────────────────────────────────────────────

export const SCAN = Object.freeze({
  // ScanResult enum values
  RESULTS: Object.freeze({
    SUCCESS: 'SUCCESS',
    INVALID: 'INVALID',
    REVOKED: 'REVOKED',
    EXPIRED: 'EXPIRED',
    INACTIVE: 'INACTIVE',
    RATE_LIMITED: 'RATE_LIMITED',
    ERROR: 'ERROR',
  }),

  // AnomalyType enum values — used in scan handler + ipReputation
  ANOMALY_TYPES: Object.freeze({
    HIGH_FREQUENCY: 'HIGH_FREQUENCY',
    MULTIPLE_LOCATIONS: 'MULTIPLE_LOCATIONS',
    SUSPICIOUS_IP: 'SUSPICIOUS_IP',
    AFTER_HOURS: 'AFTER_HOURS',
    BULK_SCRAPING: 'BULK_SCRAPING',
    HONEYPOT_TRIGGERED: 'HONEYPOT_TRIGGERED',
    REPEATED_FAILURE: 'REPEATED_FAILURE',
  }),

  // AnomalySeverity enum
  SEVERITY: Object.freeze({
    LOW: 'LOW',
    MEDIUM: 'MEDIUM',
    HIGH: 'HIGH',
    CRITICAL: 'CRITICAL',
  }),
});

// ─── Token ────────────────────────────────────────────────────────────────────

export const TOKEN = Object.freeze({
  // TokenStatus enum values
  STATUS: Object.freeze({
    UNASSIGNED: 'UNASSIGNED',
    ISSUED: 'ISSUED',
    ACTIVE: 'ACTIVE',
    INACTIVE: 'INACTIVE',
    REVOKED: 'REVOKED',
    EXPIRED: 'EXPIRED',
  }),

  // Token hash algorithm — must match auth.middleware.js
  HASH_ALGORITHM: 'sha256',
});

// ─── Encryption ───────────────────────────────────────────────────────────────

export const ENCRYPTION = Object.freeze({
  ALGORITHM: 'aes-256-cbc',
  KEY_LENGTH_BYTES: 32,
  IV_LENGTH_BYTES: 16,
  ENCODING: 'hex',

  // Fields encrypted at rest — Student, EmergencyProfile, EmergencyContact
  ENCRYPTED_FIELDS: Object.freeze(['dob_encrypted', 'phone_encrypted', 'doctor_phone_encrypted']),
});

// ─── Request ──────────────────────────────────────────────────────────────────

export const REQUEST = Object.freeze({
  // Request ID header — requestId.middleware.js
  ID_HEADER: 'x-request-id',
  ID_REGEX: /^[a-zA-Z0-9_-]{8,64}$/,

  // Content-Type header
  CONTENT_TYPE_HEADER: 'content-type',
  JSON_CONTENT_TYPE: 'application/json',

  // API version header — apiVersion.middleware.js
  VERSION_HEADER: 'api-version',
  DEFAULT_VERSION: 'v1',
  SUPPORTED_VERSIONS: Object.freeze(['v1']),
});

// ─── Pagination ───────────────────────────────────────────────────────────────

export const PAGINATION = Object.freeze({
  DEFAULT_PAGE: 1,
  DEFAULT_LIMIT: 20,
  MAX_LIMIT: 100,
});

// ─── User Roles ───────────────────────────────────────────────────────────────

export const ROLES = Object.freeze({
  SUPER_ADMIN: 'SUPER_ADMIN',
  SCHOOL_USER: 'SCHOOL_USER',
  PARENT_USER: 'PARENT_USER',
});

export const SCHOOL_ROLES = Object.freeze({
  ADMIN: 'ADMIN',
  STAFF: 'STAFF',
  VIEWER: 'VIEWER',
});

// ─── Profile ──────────────────────────────────────────────────────────────────

export const PROFILE = Object.freeze({
  // ProfileVisibility enum
  VISIBILITY: Object.freeze({
    PUBLIC: 'PUBLIC',
    MINIMAL: 'MINIMAL',
    HIDDEN: 'HIDDEN',
  }),

  // SetupStage enum
  SETUP_STAGE: Object.freeze({
    PENDING: 'PENDING',
    BASIC: 'BASIC',
    COMPLETE: 'COMPLETE',
    VERIFIED: 'VERIFIED',
  }),
});

export const TOKEN_BYTE_LENGTH = 32;
export const CARD_NUMBER_PREFIX = 'RESQID';
