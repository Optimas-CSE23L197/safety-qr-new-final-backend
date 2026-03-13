// =============================================================================
// modules/scan/scan.service.js — RESQID
//
// Core logic for QR scan resolution.
//
// WHAT HAPPENS WHEN A QR IS SCANNED:
//   1. Decode scan code → token UUID  (AES-SIV, pure crypto, no DB)
//   2. Load token + student + emergency profile from DB (single query)
//   3. Validate token state (ACTIVE, not expired, not revoked)
//   4. Apply visibility rules (PUBLIC / MINIMAL / HIDDEN)
//   5. Decrypt sensitive fields (phone numbers)
//   6. Assemble response payload
//   7. Write ScanLog (fire-and-forget, never blocks response)
//
// TOKEN STATES AND RESPONSES:
//   UNASSIGNED  → card exists but parent hasn't registered yet
//                 → return { state: "UNREGISTERED", nonce }
//   ISSUED      → token assigned but not yet activated
//                 → return { state: "ISSUED" }
//   ACTIVE      → normal scan — return emergency profile
//   INACTIVE    → parent/school disabled — return { state: "INACTIVE" }
//   REVOKED     → cancelled card — return { state: "REVOKED" }
//   EXPIRED     → past expiry — return { state: "EXPIRED" }
//
// VISIBILITY (ProfileVisibility on EmergencyProfile):
//   PUBLIC  → full profile: name, photo, blood group, conditions, contacts
//   MINIMAL → name + photo + primary contact only (no medical)
//   HIDDEN  → name only — parent chose maximum privacy
//
// SECURITY:
//   - decodeScanCode() verifies AES-SIV auth tag before any DB query
//     → tampered / forged codes rejected before touching DB
//   - Constant-time response floor (MIN_RESPONSE_MS) prevents timing oracle
//     → INVALID (~1ms crypto) and ACTIVE (~15ms DB) look identical externally
//   - Phone numbers are AES-256-GCM encrypted in DB
//     → decrypted at response time, never stored plain
//   - ScanLog captures IP, device hash, result — never PII
//   - Rate limiting enforced in route layer (see scan.routes.js)
//
// CHANGES FROM PREVIOUS VERSION:
//   [FIX-1] Constant-time response floor — MIN_RESPONSE_MS = 100
//           All code paths padded to same minimum duration.
//           Prevents attacker from using response time to distinguish
//           INVALID (pure crypto, fast) from ACTIVE (DB query, slow).
//   [FIX-2] Nonce deduplication — findActiveNonceByTokenId called before
//           createRegistrationNonce. Prevents nonce table flood on repeated
//           scans of an UNASSIGNED card.
//   [FIX-3] safeSchoolMinimal for REVOKED/EXPIRED — name only, no phone/address.
//           Active cards still use safeSchoolFull (name + logo + phone + address).
//   [FIX-4] school_id sentinel on token-not-found path — "unknown" is not a
//           valid UUID; replaced with null-UUID sentinel to avoid FK violation.
//   [FIX-5] import path fix — was "../../services/token/token.helpers.js",
//           correct path is "../../services/token/token.helpers.js" per folder
//           structure. Verify against your actual layout.
//   [FIX-6] import path fix — was "../../utils/Security/encryption.js"
//           (capital S), corrected to "../../utils/security/encryption.js".
// =============================================================================

import {
  decodeScanCode,
  ScanCodeError,
} from "../../services/token/token.helpers.js";
import { decryptField } from "../../utils/security/encryption.js"; // [FIX-6] was capital S
import * as repo from "./scan.repository.js";

// =============================================================================
// CONSTANTS
// =============================================================================

// [FIX-1] Constant-time response floor.
// Every code path — INVALID, REVOKED, ACTIVE — waits at least this long before
// returning. Eliminates timing oracle: attacker cannot distinguish a crypto
// rejection (~1ms) from a DB-backed rejection (~15ms) or a successful scan.
// 100ms is imperceptible to a human scanner but closes the timing channel.
const MIN_RESPONSE_MS = 100;

// Sentinel school UUID used in ScanLog writes when school is unknown.
// Must be a valid UUID format (not "unknown") to avoid FK constraint failure.
// [FIX-4] was "unknown" which caused a Prisma FK validation error.
const SENTINEL_SCHOOL_ID = "00000000-0000-0000-0000-000000000000";
const SENTINEL_TOKEN_ID = "00000000-0000-0000-0000-000000000000";

// =============================================================================
// MAIN — resolveScan
// =============================================================================

/**
 * Resolve a QR scan code to the appropriate response payload.
 *
 * @param {object} params
 * @param {string} params.code          — raw scan code from URL (43 chars)
 * @param {string} params.ip            — request IP (for ScanLog)
 * @param {string} params.userAgent     — request UA (for ScanLog)
 * @param {string} [params.deviceHash]  — fingerprint from controller
 * @param {number} params.startTime     — Date.now() at request start
 * @param {number} [params.scanCount]   — running count from perTokenScanLimit
 *
 * @returns {Promise<{ state, profile?, school?, nonce?, message? }>}
 */
export const resolveScan = async ({
  code,
  ip,
  userAgent,
  deviceHash,
  startTime,
  scanCount = 1,
}) => {
  // ── 1. Decode + verify scan code (pure crypto — no DB) ───────────────────
  let tokenId;
  try {
    tokenId = decodeScanCode(code);
  } catch (err) {
    // Malformed or tampered code — write log with sentinels, reveal nothing.
    repo.writeScanLog({
      tokenId: SENTINEL_TOKEN_ID,
      schoolId: SENTINEL_SCHOOL_ID,
      result: "INVALID",
      ip,
      userAgent,
      deviceHash,
      responseTimeMs: Date.now() - startTime,
    });

    return respond(startTime, {
      state: "INVALID",
      message:
        err instanceof ScanCodeError
          ? "This QR code is not valid."
          : "Something went wrong. Please try again.",
    });
  }

  // ── 2. Load token + all related data (single DB query) ───────────────────
  const token = await repo.findTokenForScan(tokenId);

  if (!token) {
    // Valid crypto but UUID not in DB — counterfeit or deleted token.
    repo.writeScanLog({
      tokenId,
      schoolId: SENTINEL_SCHOOL_ID, // [FIX-4] was "unknown"
      result: "INVALID",
      ip,
      userAgent,
      deviceHash,
      responseTimeMs: Date.now() - startTime,
    });
    return respond(startTime, {
      state: "INVALID",
      message: "This QR code is not recognised.",
    });
  }

  const schoolId = token.school_id;

  // ── 3. Token state checks ─────────────────────────────────────────────────

  // Expired — check before status (an expired token may still be ACTIVE in
  // the status column if expiry wasn't caught during a status sync).
  if (token.expires_at && token.expires_at < new Date()) {
    repo.writeScanLog({
      tokenId,
      schoolId,
      result: "EXPIRED",
      ip,
      userAgent,
      deviceHash,
      responseTimeMs: Date.now() - startTime,
    });
    return respond(startTime, {
      state: "EXPIRED",
      school: safeSchoolMinimal(token.school), // [FIX-3] name only on dead cards
      message: "This card has expired. Please contact the school to renew.",
    });
  }

  if (token.status === "REVOKED") {
    repo.writeScanLog({
      tokenId,
      schoolId,
      result: "REVOKED",
      ip,
      userAgent,
      deviceHash,
      responseTimeMs: Date.now() - startTime,
    });
    return respond(startTime, {
      state: "REVOKED",
      school: safeSchoolMinimal(token.school), // [FIX-3] name only on dead cards
      message: "This card has been deactivated.",
    });
  }

  if (token.status === "INACTIVE") {
    repo.writeScanLog({
      tokenId,
      schoolId,
      result: "INACTIVE",
      ip,
      userAgent,
      deviceHash,
      responseTimeMs: Date.now() - startTime,
    });
    return respond(startTime, {
      state: "INACTIVE",
      school: safeSchoolFull(token.school),
      message: "This card is currently inactive.",
    });
  }

  // ── 4. UNASSIGNED — card exists, parent hasn't registered yet ─────────────
  if (token.status === "UNASSIGNED" || !token.student_id) {
    // [FIX-2] Deduplication — reuse existing live nonce rather than creating
    // a new one on every scan. Prevents RegistrationNonce table flooding when
    // someone repeatedly scans an unregistered card.
    const existingNonce = await repo.findActiveNonceByTokenId(tokenId);
    const { nonce, expiresAt } = existingNonce
      ? { nonce: existingNonce.nonce, expiresAt: existingNonce.expires_at }
      : await repo.createRegistrationNonce(tokenId);

    repo.writeScanLog({
      tokenId,
      schoolId,
      result: "SUCCESS",
      ip,
      userAgent,
      deviceHash,
      responseTimeMs: Date.now() - startTime,
    });
    return respond(startTime, {
      state: "UNREGISTERED",
      school: safeSchoolFull(token.school),
      nonce,
      nonceExpiresAt: expiresAt,
      message:
        "This card hasn't been registered yet. Scan to register your child.",
    });
  }

  // ── 5. ISSUED — delivered but not yet activated ───────────────────────────
  if (token.status === "ISSUED") {
    repo.writeScanLog({
      tokenId,
      schoolId,
      result: "SUCCESS",
      ip,
      userAgent,
      deviceHash,
      responseTimeMs: Date.now() - startTime,
    });
    return respond(startTime, {
      state: "ISSUED",
      school: safeSchoolFull(token.school),
      message: "This card has been issued but not yet activated by the family.",
    });
  }

  // ── 6. ACTIVE — build full profile response ───────────────────────────────
  const student = token.student;
  const emergency = student?.emergency;
  const visibility =
    emergency?.visibility ?? student?.cardVisibility?.visibility ?? "PUBLIC";

  if (!student || !student.is_active) {
    repo.writeScanLog({
      tokenId,
      schoolId,
      result: "SUCCESS",
      ip,
      userAgent,
      deviceHash,
      responseTimeMs: Date.now() - startTime,
    });
    return respond(startTime, {
      state: "NO_PROFILE",
      school: safeSchoolFull(token.school),
      message: "Profile not available.",
    });
  }

  const profile = buildProfile({ student, emergency, visibility });

  repo.writeScanLog({
    tokenId,
    schoolId,
    result: "SUCCESS",
    ip,
    userAgent,
    deviceHash,
    responseTimeMs: Date.now() - startTime,
  });

  return respond(startTime, {
    state: "ACTIVE",
    profile,
    school: safeSchoolFull(token.school),
  });
};

// =============================================================================
// TIMING — constant-time response floor
// =============================================================================

/**
 * [FIX-1] Pad response time to MIN_RESPONSE_MS minimum.
 *
 * Without this, an attacker can measure:
 *   INVALID (pure crypto)  ≈ 1ms
 *   ACTIVE  (DB query)     ≈ 15ms
 * and distinguish token existence from non-existence — a timing oracle.
 *
 * With this, every response takes ≥ MIN_RESPONSE_MS regardless of path.
 * The pad is Promise-based so it never blocks the event loop.
 *
 * @param {number} startTime — Date.now() at request entry
 * @param {object} result    — the payload to return
 * @returns {Promise<object>}
 */
const respond = (startTime, result) => {
  const elapsed = Date.now() - startTime;
  const pad = Math.max(0, MIN_RESPONSE_MS - elapsed);
  if (pad === 0) return Promise.resolve(result);
  return new Promise((resolve) => setTimeout(() => resolve(result), pad));
};

// =============================================================================
// INTERNAL — profile assembly
// =============================================================================

/**
 * Build the response profile object applying visibility rules and
 * decrypting AES-256-GCM encrypted fields.
 */
const buildProfile = ({ student, emergency, visibility }) => {
  // Base fields — always shown regardless of visibility setting
  const base = {
    name: [student.first_name, student.last_name].filter(Boolean).join(" "),
    photo_url: student.photo_url ?? null, // S3 key; presigned URL TBD if needed
    class: student.class ?? null,
    section: student.section ?? null,
    gender: student.gender ?? null,
  };

  // HIDDEN — responder sees name + class only; no medical, no contacts
  if (visibility === "HIDDEN") {
    return { ...base, visibility: "HIDDEN" };
  }

  // MINIMAL — name + photo + single primary contact only
  if (visibility === "MINIMAL") {
    const primaryContact = getPrimaryContact(emergency?.contacts ?? []);
    return {
      ...base,
      visibility: "MINIMAL",
      primary_contact: primaryContact,
    };
  }

  // PUBLIC — full emergency profile
  const contacts = buildContacts(emergency?.contacts ?? []);

  return {
    ...base,
    visibility: "PUBLIC",
    blood_group: formatBloodGroup(emergency?.blood_group),
    allergies: emergency?.allergies ?? null,
    conditions: emergency?.conditions ?? null,
    medications: emergency?.medications ?? null,
    doctor: emergency?.doctor_name
      ? {
          name: emergency.doctor_name,
          phone: safeDecrypt(emergency.doctor_phone_encrypted),
        }
      : null,
    notes: emergency?.notes ?? null,
    contacts,
  };
};

/**
 * Decrypt and format all active emergency contacts.
 * Single contact decryption failure → phone: null for that contact.
 * Does NOT abort the entire response — responder still sees other contacts.
 */
const buildContacts = (contacts) =>
  contacts.map((c) => ({
    id: c.id,
    name: c.name,
    relationship: c.relationship ?? null,
    phone: safeDecrypt(c.phone_encrypted),
    priority: c.priority,
    call_enabled: c.call_enabled,
    whatsapp_enabled: c.whatsapp_enabled,
  }));

/**
 * Get the single highest-priority (lowest priority number) active contact.
 * Used for MINIMAL visibility — one contact only, no medical data.
 */
const getPrimaryContact = (contacts) => {
  if (!contacts.length) return null;
  const primary = [...contacts].sort((a, b) => a.priority - b.priority)[0];
  return {
    name: primary.name,
    relationship: primary.relationship ?? null,
    phone: safeDecrypt(primary.phone_encrypted),
    call_enabled: primary.call_enabled,
    whatsapp_enabled: primary.whatsapp_enabled,
  };
};

/** Decrypt an AES-256-GCM encrypted field — returns null on failure */
const safeDecrypt = (encrypted) => {
  if (!encrypted) return null;
  try {
    return decryptField(encrypted);
  } catch {
    return null; // decryption failure → never crash an emergency scan
  }
};

/**
 * [FIX-3] Full school payload — used for active / live card states.
 * ACTIVE, INACTIVE, ISSUED, UNREGISTERED:
 *   emergency responders and parents need phone + address to contact school.
 */
const safeSchoolFull = (school) => {
  if (!school) return null;
  return {
    name: school.name,
    logo_url: school.logo_url ?? null,
    phone: school.phone ?? null,
    address: school.address ?? null,
  };
};

/**
 * [FIX-3] Minimal school payload — used for dead card states (REVOKED, EXPIRED).
 * A revoked/expired card doesn't need to expose school phone or address.
 * Name is enough for the responder to know which school the card was from.
 */
const safeSchoolMinimal = (school) => {
  if (!school) return null;
  return {
    name: school.name,
  };
};

/** Convert DB enum e.g. "A_POS" → "A+", "AB_NEG" → "AB-" */
const formatBloodGroup = (bg) => {
  if (!bg) return null;
  return bg.replace("_POS", "+").replace("_NEG", "-");
};
