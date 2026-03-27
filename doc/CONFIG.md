# RESQID Configuration Architecture

## Overview

The `src/config/` folder contains all configuration modules for the RESQID application. It follows a single-source-of-truth principle where every configuration value is defined, validated, and exported from these modules.

## Folder Structure

src/config/
├── constants.js # Application-wide constants (no magic numbers/strings)
├── cookie.js # Cookie configuration and helpers
├── env.js # Environment variables validation and parsing
├── firebase.js # Firebase Admin SDK (FCM push notifications)
├── index.js # Single entry point for all config exports
├── logger.js # Pino structured logger with redaction
├── mailer.js # Nodemailer email transport
├── msg91.js # MSG91 SMS/OTP client
├── prisma.js # Prisma database client (PostgreSQL with PgBouncer)
├── razorpay.js # Razorpay payment gateway client
├── redis.js # ioredis client with three profiles
├── s3.js # AWS S3 client with presigned URLs
└── validation.js # Runtime validation and monitoring

---

## File Documentation

### 1. `constants.js`

**Purpose**: Single source of truth for all application-wide constants.

**Exports**:

| Export               | Description                                         |
| -------------------- | --------------------------------------------------- |
| `AUTH`               | JWT, blacklist, session, bearer token configuration |
| `OTP`                | OTP expiry, attempts, rate limiting                 |
| `SESSION`            | Session expiry, revoke reasons                      |
| `DEVICE`             | Device cache TTL, headers, logout reasons           |
| `RATE_LIMIT`         | Rate limiting windows and limits for all endpoints  |
| `SLOW_DOWN`          | Slow down middleware configuration                  |
| `CSRF`               | CSRF token configuration and exempt routes          |
| `TENANT`             | School and parent-child cache configuration         |
| `IP`                 | IP blocking, trust lists, geolocation               |
| `MAINTENANCE`        | Maintenance mode configuration                      |
| `FEATURE_FLAGS`      | Feature flag keys                                   |
| `AUDIT`              | Audit log actor types, actions, redacted fields     |
| `SCAN`               | Scan results, anomaly types, severity levels        |
| `TOKEN`              | Token status values, hash algorithm                 |
| `ENCRYPTION`         | AES encryption algorithm and fields                 |
| `REQUEST`            | Request ID headers, API versioning                  |
| `PAGINATION`         | Default page, limit, max limit                      |
| `ROLES`              | User roles (SUPER_ADMIN, SCHOOL_USER, PARENT_USER)  |
| `SCHOOL_ROLES`       | School-level roles (ADMIN, STAFF, VIEWER)           |
| `PROFILE`            | Profile visibility and setup stages                 |
| `TOKEN_BYTE_LENGTH`  | Token byte length for generation                    |
| `CARD_NUMBER_PREFIX` | Prefix for physical card numbers                    |

**Key Features**:

- All objects frozen to prevent mutation
- Time values in milliseconds (unless suffixed)
- Domain grouping for easy maintenance

---

### 2. `env.js`

**Purpose**: Validates, coerces, and exports all environment variables. Crashes at startup with clear error messages if required variables are missing.

**Validation Features**:

| Feature          | Description                                  |
| ---------------- | -------------------------------------------- |
| `required()`     | Enforces presence, minLength, allowed values |
| `optional()`     | Returns default or empty string              |
| `optionalInt()`  | Parses integer, validates type               |
| `optionalBool()` | Parses boolean (true/false)                  |
| `optionalJson()` | Parses JSON, validates format                |

**Cross-Field Validation**:

- Redis Sentinel vs Cluster conflict detection
- JWT access and refresh secrets must be different
- All HMAC secrets must be unique
- Encryption key must be 64 hex characters (32 bytes)
- TLS requires password in production

**Environment Variables**:

| Category   | Variables                                                                                           |
| ---------- | --------------------------------------------------------------------------------------------------- |
| Server     | `NODE_ENV`, `PORT`, `API_URL`, `TRUST_PROXY`                                                        |
| Database   | `DATABASE_URL`, `SHADOW_DATABASE_URL`                                                               |
| Redis      | `REDIS_URL`, `REDIS_PASSWORD`, `REDIS_TLS`, `REDIS_KEY_PREFIX`, `REDIS_SENTINEL*`, `REDIS_CLUSTER*` |
| JWT        | `JWT_ACCESS_SECRET`, `JWT_ACCESS_EXPIRY`, `JWT_REFRESH_SECRET`, `JWT_REFRESH_EXPIRY`                |
| CSRF       | `CSRF_SECRET`                                                                                       |
| URLs       | `SUPER_ADMIN_URL`, `SCHOOL_ADMIN_URL`, `MOBILE_APP_SCHEME`, `CDN_URL`, `SCAN_BASE_URL`              |
| AWS S3     | `AWS_ACCESS_KEY_ID`, `AWS_SECRET_ACCESS_KEY`, `AWS_REGION`, `AWS_S3_BUCKET`                         |
| MSG91      | `MSG91_AUTH_KEY`, `MSG91_OTP_TEMPLATE_ID`, `MSG91_SENDER_ID`, `MSG91_ROUTE`                         |
| Razorpay   | `RAZORPAY_KEY_ID`, `RAZORPAY_KEY_SECRET`, `RAZORPAY_WEBHOOK_SECRET`                                 |
| Email      | `SMTP_HOST`, `SMTP_PORT`, `SMTP_USER`, `SMTP_PASS`, `EMAIL_FROM`                                    |
| Firebase   | `FIREBASE_PROJECT_ID`, `FIREBASE_CLIENT_EMAIL`, `FIREBASE_PRIVATE_KEY`                              |
| Encryption | `ENCRYPTION_KEY`, `LOOKUP_HASH_SECRET`, `TOKEN_HASH_SECRET`, `SCAN_CODE_SECRET`                     |
| Logging    | `LOG_LEVEL`, `LOG_FORMAT`, `LOG_FILE_PATH`                                                          |
| Sentry     | `SENTRY_DSN`, `SENTRY_ENVIRONMENT`, `SENTRY_TRACES_SAMPLE_RATE`                                     |
| Other      | `BEHIND_CLOUDFLARE`, `TOKEN_VALIDITY_MONTHS`, `RATE_LIMIT_*`                                        |

**Derived Flags**:

- `ENV.IS_PROD` - true when NODE_ENV === "production"
- `ENV.IS_DEV` - true when NODE_ENV === "development"
- `ENV.IS_STAGING` - true when NODE_ENV === "staging"

---

### 3. `cookie.js`

**Purpose**: Cookie configuration for authentication tokens.

**Exports**:

| Export                                           | Description                                          |
| ------------------------------------------------ | ---------------------------------------------------- |
| `cookieConfig`                                   | Cookie settings for access, refresh, and CSRF tokens |
| `setAuthCookies(res, accessToken, refreshToken)` | Sets both auth cookies                               |
| `clearAuthCookies(res)`                          | Clears auth cookies                                  |
| `setCsrfCookie(res, csrfToken)`                  | Sets CSRF cookie                                     |
| `clearCsrfCookie(res)`                           | Clears CSRF cookie                                   |

**Cookie Security**:

| Token        | httpOnly | secure          | sameSite                  |
| ------------ | -------- | --------------- | ------------------------- |
| accessToken  | true     | production only | strict (prod) / lax (dev) |
| refreshToken | true     | production only | strict (prod) / lax (dev) |
| csrfToken    | false    | production only | lax                       |

---

### 4. `logger.js`

**Purpose**: Production-grade structured logger using Pino with automatic sensitive data redaction.

**Features**:

- JSON in production, pretty in development
- Automatic redaction of passwords, tokens, PII
- File transport support
- Child logger factory for request context
- Sentry integration for errors/fatal logs

**Redacted Fields**:

- Passwords and password hashes
- Tokens (access, refresh, token_hash)
- OTP and OTP hashes
- Encrypted PII (phone, dob, doctor_phone)
- Payment information (cvv, card_number)
- Authorization headers

**Exports**:

| Export                         | Description                               |
| ------------------------------ | ----------------------------------------- |
| `logger`                       | Base logger instance                      |
| `createRequestLogger(context)` | Creates child logger with request context |

**Usage**:

```javascript
import { logger, createRequestLogger } from "./config/logger.js";

// Basic logging
logger.info({ userId: 123 }, "User logged in");
logger.error({ err }, "Something failed");

// Request-scoped logging
const reqLogger = createRequestLogger({ requestId: "abc-123" });
reqLogger.info("Processing request");

5. redis.js
Purpose: ioredis client with three distinct profiles for different use cases.

Three Client Profiles:

Client	Purpose	Key Features
redis	HTTP request path (state.service, ip-block)	enableOfflineQueue: false - fails fast, never hangs requests
middlewareRedis	Rate-limiter, session, blacklist, health checks	enableOfflineQueue: true - survives Redis reconnects at startup
workerRedis	BullMQ queues, workers, idempotency	maxRetriesPerRequest: null - required by BullMQ
Exports:

Export	Description
redis	HTTP-path client (fail-fast)
middlewareRedis	Middleware client (queue commands)
workerRedis	BullMQ client
createPubSubClient(name)	Creates fresh client for PUB/SUB operations
createWorkerRedisClient(name)	Creates fresh BullMQ-compatible client
checkRedisHealth()	Health check for /health endpoint
getRedisStats()	Connection pool statistics
disconnectRedis()	Graceful disconnect all clients
Supported Modes:

Single node (default)

Sentinel (high availability)

Cluster (sharding)

6. prisma.js
Purpose: Singleton Prisma client with PgBouncer adapter for PostgreSQL.

Features:

Single instance across the app (prevents connection pool exhaustion)

Query logging in development

Slow query detection (>1000ms)

Graceful shutdown support

Health check export

Exports:

Export	Description
prisma	Prisma client instance
checkPrismaHealth()	Database connectivity check
disconnectPrisma()	Graceful disconnect
Logging Behavior:

Environment	Logged Events
Development	query, info, warn, error (with slow query warnings)
Production	warn, error only
7. s3.js
Purpose: AWS S3 client for QR asset and card file storage.

Features:

Single S3Client instance (AWS SDK v3)

MinIO compatible (via AWS_S3_ENDPOINT override)

Presigned URLs for secure uploads/downloads

Automatic server-side encryption (AES256)

Health check via HeadBucket

Exports:

Export	Description
s3	S3 client instance
BUCKET	Current bucket name
S3_PREFIXES	Key prefixes (QR, CARD, LOGO, PHOTO, INVOICE, TEMPLATE)
uploadFile(key, body, options)	Upload file to S3
getFileBuffer(key)	Download file as Buffer
deleteFile(key)	Delete file from S3
copyFile(sourceKey, destKey)	Server-side copy
getPresignedUploadUrl(key, contentType, expiresIn)	Generate upload URL
getPresignedDownloadUrl(key, expiresIn)	Generate download URL
buildCdnUrl(key)	Build public CDN URL
fileExists(key)	Check if file exists
checkS3Health()	S3 connectivity check
8. mailer.js
Purpose: Nodemailer transporter for email notifications.

Features:

SMTP connection pool (5 connections)

Automatic retry on transient failures (3 attempts, exponential backoff)

Dev mode: Ethereal fake SMTP (emails visible at ethereal.email)

HTML + plain text fallback

Attachment support

Rate limiting (10 emails/second)

Exports:

Export	Description
sendMail({ to, subject, html, text, attachments })	Send email with retry logic
checkMailerHealth()	SMTP connectivity check
closeMailer()	Graceful close connection pool
Retry Configuration:

Max attempts: 3

Retry delays: 1000ms, 3000ms, 9000ms

Transient errors: ECONNRESET, ECONNREFUSED, ETIMEDOUT, SMTP 4xx codes

9. msg91.js
Purpose: MSG91 client for OTP delivery and transactional SMS.

Environment Behavior:

NODE_ENV	Behavior
development	Mock mode - logs to console, never sends actual SMS/OTP
staging	Live mode - real API calls
production	Live mode - real API calls
Exports:

Export	Description
sendOtp(phone)	Send 6-digit OTP (returns { otp, msg91ReqId })
sendSms(phone, message)	Send transactional SMS (returns request ID)
sendTemplateSms(phone, templateId, variables)	Send template SMS with variables
checkMsg91Health()	API connectivity check
Dev Mode:

OTP always 123456

Request ID always dev-mock-req-id

All operations logged with (NOT SENT - mock mode) prefix

10. firebase.js
Purpose: Firebase Admin SDK for FCM push notifications.

Features:

Single Firebase Admin app instance

Single device push notifications

Multicast (up to 500 devices)

Dev mode: logs instead of sending

Automatic invalid token detection

Exports:

Export	Description
sendPushNotification(deviceToken, notification, data, platform)	Send to single device
sendMulticast(deviceTokens, notification, data)	Send to multiple devices (max 500)
Platform Support:

Android: high priority, channelId "resqid_alerts"

iOS: sound, badge, high priority headers

Web: default FCM behavior

11. razorpay.js
Purpose: Razorpay client for payments and subscriptions.

Features:

Order creation for card fees

Subscription creation for recurring plans

Webhook signature verification (HMAC-SHA256)

Payment signature verification

Refund creation

Subscription cancellation

Exports:

Export	Description
razorpay	Razorpay client instance
createOrder(amountPaise, options)	Create payment order
createSubscription(planId, options)	Create subscription
verifyWebhookSignature(rawBody, signature)	Verify webhook authenticity
verifyPaymentSignature(orderId, paymentId, signature)	Verify payment signature
fetchPayment(paymentId)	Get payment details
createRefund(paymentId, amountPaise, notes)	Issue refund
cancelSubscription(subscriptionId, cancelAtCycleEnd)	Cancel subscription
Security:

Constant-time signature comparison (timing attack prevention)

Webhook verification uses raw request body

Separate secrets for webhook and payment verification

12. validation.js
Purpose: Runtime validation, monitoring, and health checks.

Features:

Runtime configuration validation

Connection pool monitoring

Enhanced health checks

Graceful shutdown with timeout

Startup banner with configuration summary

Exports:

Export	Description
ADDITIONAL_CONSTANTS	Webhook, rate limit headers, CORS configuration
validateRuntimeConfig()	Validates Redis, S3, DB, secrets at startup
startConnectionMonitoring(intervalMs)	Periodic connection leak detection
stopConnectionMonitoring()	Stop monitoring
enhancedHealthCheck()	Comprehensive service health check
enhancedGracefulShutdown(signal)	Graceful shutdown with 30s timeout
printStartupBanner()	Beautiful startup banner
Monitoring Thresholds:

Redis connection increase > 50 and > 200 total → warning

Heap memory increase > 20% and > 100MB → warning

13. index.js
Purpose: Single entry point for all configuration exports.

Exports: Re-exports all modules (constants, env, logger, redis, prisma, s3, mailer, msg91, firebase, razorpay, cookie, validation)

Usage:

javascript
// Single import for all configs
import { ENV, logger, prisma, redis } from "./config/index.js";

```

# Database

DATABASE_URL=postgresql://user:pass@localhost:5432/resqid

# Redis

REDIS_URL=redis://localhost:6379

# JWT (32+ characters each, must be different)

JWT_ACCESS_SECRET=your-32-char-min-secret-here
JWT_REFRESH_SECRET=your-different-32-char-secret-here

# CSRF (32+ characters)

CSRF_SECRET=your-32-char-csrf-secret-here

# Maintenance Bypass (16+ characters)

MAINTENANCE_BYPASS_SECRET=your-16-char-bypass-secret

# Application URLs

SUPER_ADMIN_URL=https://admin.resqid.in
SCHOOL_ADMIN_URL=https://school.resqid.in

# Encryption (64 hex characters = 32 bytes)

ENCRYPTION_KEY=0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef

# HMAC Secrets (32+ characters each, all different)

LOOKUP_HASH_SECRET=your-32-char-lookup-secret
TOKEN_HASH_SECRET=your-32-char-token-hash-secret
SCAN_CODE_SECRET=your-64-char-scan-code-secret

# AWS S3 (required in production)

AWS_ACCESS_KEY_ID=AKIA...
AWS_SECRET_ACCESS_KEY=...
AWS_S3_BUCKET=resqid-assets

# MSG91 (required in production)

MSG91_AUTH_KEY=your-msg91-auth-key
MSG91_OTP_TEMPLATE_ID=your-otp-template-id

# Razorpay (required in production)

RAZORPAY*KEY_ID=rzp_test*...
RAZORPAY_KEY_SECRET=...
RAZORPAY_WEBHOOK_SECRET=...

# SMTP (required in production)

SMTP_HOST=smtp.gmail.com
SMTP_USER=your-email@gmail.com
SMTP_PASS=your-app-password

# Firebase (required in production)

FIREBASE_PROJECT_ID=resqid-12345
FIREBASE_CLIENT_EMAIL=firebase-adminsdk@resqid.iam.gserviceaccount.com
FIREBASE_PRIVATE_KEY="-----BEGIN PRIVATE KEY-----\n..."

```
