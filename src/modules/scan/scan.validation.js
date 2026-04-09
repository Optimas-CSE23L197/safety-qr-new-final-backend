// =============================================================================
// modules/scan/scan.validation.js — RESQID
//
// Zod schemas for the public QR scan endpoint.
// scanCodeRegex exported for reuse in qr.service.js, token.helpers.js, etc.
// =============================================================================

import { z } from 'zod';

/**
 * 43-char base62 regex — matches AES-SIV encoded scan token.
 * FIX: Exported so qr.service.js and other callers don't duplicate it.
 *
 * NOTE: Confirm encoder output charset before going to production.
 * If encoder only produces lowercase + digits (common for URL-safe tokens),
 * tighten to /^[a-z0-9]{43}$/ — uppercase in regex accepts inputs that
 * will always fail decodeScanCode() (wasted DB round-trip).
 */
export const scanCodeRegex = /^[A-Za-z0-9]{43}$/;

/**
 * Validates :code param in GET /s/:code
 * FIX: Added .strict() — extra param fields no longer pass through silently.
 * Used in: scan.routes.js → validateAll({ params: scanCodeSchema })
 */
export const scanCodeSchema = z
  .object({
    code: z.string().regex(scanCodeRegex, 'Invalid scan code format'),
  })
  .strict();

/**
 * Reserved for future POST /s/:code endpoint with optional location data.
 * IMPORTANT: Before activating this route:
 *   1. Add explicit consent field or confirm consent is handled upstream
 *   2. Complete DPDP Act 2023 compliance review for geolocation collection
 *   3. Ensure location data is purpose-limited to emergency context only
 *
 * FIX: Added `accuracy` minimum of 1m — sub-1m precision is physically
 *      impossible from phone GPS and signals spoofed/fake location data.
 * FIX: Added `UNKNOWN` to device_type enum — prevents unexpected 400s
 *      from web clients that don't fit ANDROID/IOS/WEB.
 */
export const scanEventSchema = z
  .object({
    code: z.string().regex(scanCodeRegex, 'Invalid scan code format'),

    device_type: z.enum(['ANDROID', 'IOS', 'WEB', 'UNKNOWN']).optional(),

    latitude: z.number().min(-90).max(90).optional(),
    longitude: z.number().min(-180).max(180).optional(),

    // FIX: min(1) — physically impossible to have sub-1m GPS accuracy on phone
    accuracy: z.number().min(1).max(1000).optional(),

    user_agent: z.string().max(500).optional(),
  })
  .strict()
  .refine(data => (data.latitude !== undefined) === (data.longitude !== undefined), {
    message: 'latitude and longitude must be provided together',
  });
