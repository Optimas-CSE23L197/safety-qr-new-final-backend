// =============================================================================
// apiVersion.middleware.js — RESQID
// API version enforcement and deprecation management
// Reads API-Version header or URL prefix — rejects unsupported versions
//
// Why this matters:
//   Without versioning enforcement, you can never safely make breaking
//   changes. Old mobile app versions (which parents may not update) will
//   silently hit new API behaviour and break. This middleware:
//     - Attaches the resolved API version to every request (req.apiVersion)
//     - Rejects clients on deprecated versions with a clear upgrade message
//     - Allows emergency endpoint to be version-free (always latest)
//
// Strategy:
//   Version is read from (in priority order):
//     1. URL prefix:       /api/v2/students
//     2. Header:           API-Version: 2
//     3. Default:          v1 (current stable)
//
// Current versions:
//   v1 — current stable (all existing routes)
//   v2 — not yet released (placeholder for future breaking changes)
//
// When v2 ships:
//   - Set DEPRECATED_VERSIONS = ["v1"] with a sunset date
//   - Old app versions get a 410 Gone with upgrade instructions
// =============================================================================

import { ApiError } from '#shared/response/ApiError.js';
import { asyncHandler } from '#shared/response/asyncHandler.js';

// ─── Version Config ───────────────────────────────────────────────────────────

const SUPPORTED_VERSIONS = new Set(['v1']); // add "v2' when released
const DEPRECATED_VERSIONS = new Set([]); // move 'v1' here when v2 ships
const DEFAULT_VERSION = 'v1';
const VERSION_HEADER = 'api-version';

// Routes that are version-free — always served on current implementation
const VERSION_FREE_PREFIXES = [
  '/api/emergency', // public QR scan — must always work regardless of app version
  '/health',
  '/api/health',
  '/api/webhooks', // external providers don"t send API-Version header
];

// Sunset dates for deprecated versions (informational — shown in response)
const SUNSET_DATES = {
  // "v1': '2026-12-31'  — fill in when v2 ships
};

// ─── Core Middleware ──────────────────────────────────────────────────────────

/**
 * apiVersion
 * Resolves API version from URL or header, attaches to req, rejects unsupported.
 * Register near the top of app.js, after requestId and maintenanceMode.
 */
export const apiVersion = asyncHandler(async (req, _res, next) => {
  // Skip version-free routes
  if (VERSION_FREE_PREFIXES.some(p => req.path.startsWith(p))) {
    req.apiVersion = DEFAULT_VERSION;
    return next();
  }

  // [1] Try URL prefix — /api/v1/... or /api/v2/...
  const urlVersion = extractVersionFromUrl(req.path);

  // [2] Try header — API-Version: 1 or API-Version: v1
  const headerVersion = normalizeVersion(req.headers[VERSION_HEADER]);

  const version = urlVersion ?? headerVersion ?? DEFAULT_VERSION;

  // Reject completely unknown versions
  if (!SUPPORTED_VERSIONS.has(version) && !DEPRECATED_VERSIONS.has(version)) {
    throw ApiError.badRequest(
      `Unsupported API version '${version}'. Supported: [${[...SUPPORTED_VERSIONS].join(', ')}]`
    );
  }

  // Reject deprecated versions
  if (DEPRECATED_VERSIONS.has(version)) {
    const sunset = SUNSET_DATES[version];
    throw ApiError.create(
      410,
      `API version '${version}" has been discontinued.${
        sunset ? ` It was sunset on ${sunset}.` : ''
      } Please upgrade to v${getLatestVersion()}.`
    );
  }

  req.apiVersion = version;
  next();
});

// ─── Helpers ──────────────────────────────────────────────────────────────────

function extractVersionFromUrl(path) {
  // Match /api/v1/ or /v1/ patterns
  const match = path.match(/\/v(\d+)\//i);
  if (match) return `v${match[1]}`;
  return null;
}

function normalizeVersion(raw) {
  if (!raw) return null;
  const trimmed = raw.trim().toLowerCase();
  // Accept "1", "v1', '1.0'
  const match = trimmed.match(/^v?(\d+)/);
  if (match) return `v${match[1]}`;
  return null;
}

function getLatestVersion() {
  const versions = [...SUPPORTED_VERSIONS]
    .map(v => parseInt(v.replace('v', ''), 10))
    .sort((a, b) => b - a);
  return `v${versions[0]}`;
}
