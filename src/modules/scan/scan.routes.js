// =============================================================================
// modules/scan/scan.routes.js — RESQID
//
// Public QR scan routes — NO authentication required.
// Mounted at /s in routes/index.js:
//   router.use("/s", scanRoute)
//
// Full URL: GET https://resqid.in/s/:code
//   :code — 43-char AES-SIV scan code (base62, 32 bytes encoded)
//
// SECURITY LAYERS (no auth needed because):
//   1. checkIpBlocked       — DB persistent IP block check (before anything)
//   2. publicEmergencyLimiter — Redis-backed 10 req/min per IP (cluster-safe)
//   3. perTokenScanLimit    — Redis-backed 20 scans/hr per scan code
//   4. code length guard    — express param regex rejects anything ≠ 43 chars
//   5. decodeScanCode()     — AES-SIV verification before any DB query
//      → forged / tampered codes are rejected in pure crypto, never reach DB
//
// CHANGES FROM PREVIOUS VERSION:
//   [FIX-1] Code length 28 → 43 (AES-SIV output is 32 bytes = 43 base62 chars)
//   [FIX-2] Removed local in-memory scanLimiter (was per-process, not cluster-safe)
//   [FIX-3] Imported and wired checkIpBlocked, publicEmergencyLimiter,
//           perTokenScanLimit from rateLimit.middleware.js
// =============================================================================

import { Router } from "express";
import { scanQr } from "./scan.controller.js";
import { validate } from "../../middleware/validate.middleware.js";
import {
  checkIpBlocked,
  publicEmergencyLimiter,
  perTokenScanLimit,
} from "../../middleware/rateLimit.middleware.js";
import { scanCodeSchema } from "./scan.validation.js";

const router = Router();

// ── Route ─────────────────────────────────────────────────────────────────────
// Regex on :code — only allows base62 chars (alphanumeric), exactly 43 chars.
// AES-SIV encodes 32 bytes → always exactly 43 base62 characters.
// Anything else hits the catch-all below before any middleware runs.
//
// Middleware order matters:
//   checkIpBlocked       → cheapest DB check, kills known-bad IPs immediately
//   publicEmergencyLimiter → Redis sliding window per IP
//   perTokenScanLimit    → Redis per-token 20/hr cap, persists anomalies to DB
//   scanQr               → controller (crypto verify → DB → response)
router.get(
  "/:code",
  validate(scanCodeSchema, "params"),
  checkIpBlocked,
  publicEmergencyLimiter,
  perTokenScanLimit,
  scanQr,
);

// Catch-all for malformed codes (wrong length, bad chars)
// Hits immediately from Express param regex — no middleware runs for these.
router.get("/:code", (_req, res) => {
  res.status(400).json({
    success: false,
    message: "Invalid QR code format.",
  });
});

export default router;
