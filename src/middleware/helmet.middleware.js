// =============================================================================
// helmet.middleware.js — RESQID
// Maximum security headers — different policies per route type
// Public emergency page has relaxed CSP (needs to load in any browser)
// Dashboard has strict CSP (known origins only)
// =============================================================================

import helmet from "helmet";
import { ENV } from "../config/env.js";

const IS_PROD = ENV.NODE_ENV === "production";

// ─── Shared Base Config ───────────────────────────────────────────────────────

const baseConfig = {
  // X-DNS-Prefetch-Control: off
  dnsPrefetchControl: { allow: false },

  // X-Frame-Options: DENY — prevents clickjacking
  frameguard: { action: "deny" },

  // Hide X-Powered-By: Express
  hidePoweredBy: true,

  // HTTP Strict Transport Security — 1 year, include subdomains
  hsts: IS_PROD
    ? { maxAge: 31536000, includeSubDomains: true, preload: true }
    : false,

  // X-Content-Type-Options: nosniff
  noSniff: true,

  // X-Download-Options: noopen (IE8+)
  ieNoOpen: true,

  // Referrer-Policy: strict-origin-when-cross-origin
  referrerPolicy: { policy: "strict-origin-when-cross-origin" },

  // X-XSS-Protection: disabled (CSP replaces this, old header causes issues)
  xssFilter: false,

  // Permissions-Policy — disable all dangerous browser features
  permittedCrossDomainPolicies: { permittedPolicies: "none" },
};

// ─── Dashboard CSP (Super Admin + School Admin) ───────────────────────────────

export const dashboardHelmet = helmet({
  ...baseConfig,
  contentSecurityPolicy: {
    directives: {
      defaultSrc: ["'self'"],
      scriptSrc: ["'self'", "'strict-dynamic'"],
      styleSrc: ["'self'", "'unsafe-inline'"], // needed for most UI libs
      imgSrc: ["'self'", "data:", "blob:", ENV.CDN_URL].filter(Boolean),
      fontSrc: ["'self'", "data:"],
      connectSrc: ["'self'", ENV.API_URL].filter(Boolean),
      frameSrc: ["'none'"],
      objectSrc: ["'none'"],
      baseUri: ["'self'"],
      formAction: ["'self'"],
      upgradeInsecureRequests: IS_PROD ? [] : null,
    },
  },
  crossOriginEmbedderPolicy: true,
  crossOriginOpenerPolicy: { policy: "same-origin" },
  crossOriginResourcePolicy: { policy: "same-origin" },
});

// ─── Public Emergency Page CSP ────────────────────────────────────────────────
// Must load in ANY browser — phone camera opens this
// Can't assume anything about the client environment

export const publicHelmet = helmet({
  ...baseConfig,
  contentSecurityPolicy: {
    directives: {
      defaultSrc: ["'self'"],
      scriptSrc: ["'self'"],
      styleSrc: ["'self'", "'unsafe-inline'"],
      imgSrc: ["'self'", "data:", ENV.CDN_URL].filter(Boolean),
      fontSrc: ["'self'", "data:"],
      connectSrc: ["'self'"],
      frameSrc: ["'none'"],
      objectSrc: ["'none'"],
      baseUri: ["'self'"],
      // Allow tel: links for direct calling
      formAction: ["'none'"],
      upgradeInsecureRequests: IS_PROD ? [] : null,
    },
  },
  // Relax for public — different origins will embed this page
  crossOriginOpenerPolicy: { policy: "unsafe-none" },
  crossOriginResourcePolicy: { policy: "cross-origin" },
  crossOriginEmbedderPolicy: false,
});

// ─── API Routes CSP (JSON only — no HTML served) ─────────────────────────────

export const apiHelmet = helmet({
  ...baseConfig,
  contentSecurityPolicy: false, // API returns JSON — CSP irrelevant
  crossOriginEmbedderPolicy: false,
  crossOriginOpenerPolicy: { policy: "same-origin" },
  crossOriginResourcePolicy: { policy: "same-origin" },
});

// ─── Default export ───────────────────────────────────────────────────────────
export const helmetMiddleware = apiHelmet;
