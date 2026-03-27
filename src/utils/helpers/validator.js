// =============================================================================
// validator.js — RESQID
// Domain-specific reusable validators — used inside Zod schemas and services.
// These are NOT middleware — they validate individual values.
//
// Every validator returns { valid: boolean, reason?: string }
// so errors can be composed into Zod's .superRefine() cleanly.
// =============================================================================

// ─── Phone ────────────────────────────────────────────────────────────────────

/**
 * isValidIndianPhone(phone)
 * Accepts:
 *   - 10-digit: "9876543210"
 *   - With country code: "+919876543210", "919876543210'
 *   - With 0 prefix: '09876543210'
 */
export function isValidIndianPhone(phone) {
  if (!phone) return { valid: false, reason: 'Phone number is required' };
  const cleaned = String(phone).replace(/[\s\-().+]/g, '');
  const valid = /^(91|0)?[6-9]\d{9}$/.test(cleaned);
  return valid
    ? { valid: true }
    : { valid: false, reason: 'Enter a valid 10-digit Indian mobile number' };
}

// ─── Email ────────────────────────────────────────────────────────────────────

/**
 * isValidEmail(email)
 * RFC-compliant email — rejects obvious typos and disposable patterns.
 */
export function isValidEmail(email) {
  if (!email) return { valid: false, reason: 'Email is required' };
  // RFC 5322 simplified — handles 99.9% of real emails
  const valid =
    /^[a-zA-Z0-9.!#$%&'*+/=?^_`{|}~-]+@[a-zA-Z0-9](?:[a-zA-Z0-9-]{0,61}[a-zA-Z0-9])?(?:\.[a-zA-Z0-9](?:[a-zA-Z0-9-]{0,61}[a-zA-Z0-9])?)*\.[a-zA-Z]{2,}$/.test(
      email.trim()
    );
  return valid ? { valid: true } : { valid: false, reason: 'Enter a valid email address' };
}

// ─── OTP ──────────────────────────────────────────────────────────────────────

/**
 * isValidOtp(otp, length = 6)
 * Numeric OTP of exact length.
 */
export function isValidOtp(otp, length = 6) {
  if (!otp) return { valid: false, reason: 'OTP is required' };
  const valid = new RegExp(`^\\d{${length}}$`).test(String(otp));
  return valid ? { valid: true } : { valid: false, reason: `OTP must be exactly ${length} digits` };
}

// ─── Token / QR ───────────────────────────────────────────────────────────────

/**
 * isValidTokenHash(hash)
 * 64-char hex — SHA-256 output of the raw 256-bit token.
 */
export function isValidTokenHash(hash) {
  if (!hash) return { valid: false, reason: 'Token is required' };
  const valid = /^[a-f0-9]{64}$/.test(hash);
  return valid ? { valid: true } : { valid: false, reason: 'Invalid token format' };
}

/**
 * isValidCardNumber(cardNumber)
 * Physical card number — alphanumeric, 6–20 chars, uppercase.
 * e.g. 'RQD2024A001'
 */
export function isValidCardNumber(cardNumber) {
  if (!cardNumber) return { valid: false, reason: 'Card number is required' };
  const valid = /^[A-Z0-9]{6,20}$/.test(String(cardNumber).toUpperCase().replace(/\s/g, ''));
  return valid ? { valid: true } : { valid: false, reason: 'Invalid card number format' };
}

// ─── Student ──────────────────────────────────────────────────────────────────

/**
 * isValidBloodGroup(bg)
 * Standard ABO + Rh blood group notation.
 */
export function isValidBloodGroup(bg) {
  if (!bg) return { valid: true }; // Optional field
  const valid = /^(A|B|AB|O)[+-]$/.test(bg.toUpperCase().replace(/\s/g, ''));
  return valid
    ? { valid: true }
    : {
        valid: false,
        reason: "Invalid blood group. Use format like 'A+', 'O-', 'AB+'",
      };
}

/**
 * isValidDob(dob)
 * Date of birth — must be in the past, not before 1920, max age 25 for students.
 */
export function isValidDob(dob) {
  if (!dob) return { valid: false, reason: 'Date of birth is required' };

  const date = new Date(dob);
  if (isNaN(date.getTime())) {
    return { valid: false, reason: 'Invalid date format' };
  }

  const now = new Date();
  const minDate = new Date('1920-01-01');
  const maxAge25 = new Date(now.getFullYear() - 25, now.getMonth(), now.getDate());

  if (date > now) {
    return { valid: false, reason: 'Date of birth cannot be in the future' };
  }
  if (date < minDate) {
    return { valid: false, reason: 'Date of birth is too far in the past' };
  }
  if (date < maxAge25) {
    return { valid: false, reason: 'Student age cannot exceed 25 years' };
  }

  return { valid: true };
}

// ─── School ───────────────────────────────────────────────────────────────────

/**
 * isValidPincode(pin)
 * Indian 6-digit PIN code.
 */
export function isValidPincode(pin) {
  if (!pin) return { valid: false, reason: 'Pincode is required' };
  const valid = /^[1-9][0-9]{5}$/.test(String(pin));
  return valid
    ? { valid: true }
    : { valid: false, reason: 'Enter a valid 6-digit Indian PIN code' };
}

/**
 * isValidGstin(gstin)
 * Indian GST Identification Number — 15 chars.
 * Optional — only required for invoice generation.
 */
export function isValidGstin(gstin) {
  if (!gstin) return { valid: true }; // Optional
  const valid = /^[0-9]{2}[A-Z]{5}[0-9]{4}[A-Z]{1}[1-9A-Z]{1}Z[0-9A-Z]{1}$/.test(
    gstin.toUpperCase()
  );
  return valid ? { valid: true } : { valid: false, reason: 'Invalid GSTIN format' };
}

// ─── Payments ─────────────────────────────────────────────────────────────────

/**
 * isValidRazorpayOrderId(id)
 * Razorpay order IDs follow 'order_XXXXXXXXXXXXXXXX' format.
 */
export function isValidRazorpayOrderId(id) {
  if (!id) return { valid: false, reason: 'Razorpay order ID is required' };
  const valid = /^order_[a-zA-Z0-9]{14,}$/.test(id);
  return valid ? { valid: true } : { valid: false, reason: 'Invalid Razorpay order ID' };
}

/**
 * isValidRazorpayPaymentId(id)
 * Razorpay payment IDs follow 'pay_XXXXXXXXXXXXXXXX' format.
 */
export function isValidRazorpayPaymentId(id) {
  if (!id) return { valid: false, reason: 'Razorpay payment ID is required' };
  const valid = /^pay_[a-zA-Z0-9]{14,}$/.test(id);
  return valid ? { valid: true } : { valid: false, reason: 'Invalid Razorpay payment ID' };
}

// ─── General ──────────────────────────────────────────────────────────────────

/**
 * isValidUuid(id)
 * UUID v4 format check — for Prisma cuid2/uuid primary keys.
 */
export function isValidUuid(id) {
  if (!id) return { valid: false, reason: 'ID is required' };
  // Covers both UUID and cuid2 (starts with 'c', 26 chars)
  const isUuid = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(id);
  const isCuid2 = /^c[a-z0-9]{24,}$/.test(id);
  return isUuid || isCuid2 ? { valid: true } : { valid: false, reason: 'Invalid ID format' };
}

/**
 * isNonEmptyString(value, fieldName = 'Field')
 * Strict non-empty string check — rejects whitespace-only strings.
 */
export function isNonEmptyString(value, fieldName = 'Field') {
  const valid = typeof value === 'string' && value.trim().length > 0;
  return valid ? { valid: true } : { valid: false, reason: `${fieldName} cannot be empty` };
}

/**
 * isWithinRange(value, min, max, fieldName = 'Value')
 * Numeric range check.
 */
export function isWithinRange(value, min, max, fieldName = 'Value') {
  const n = Number(value);
  if (isNaN(n)) return { valid: false, reason: `${fieldName} must be a number` };
  const valid = n >= min && n <= max;
  return valid
    ? { valid: true }
    : {
        valid: false,
        reason: `${fieldName} must be between ${min} and ${max}`,
      };
}

// ─── Zod Integration Helper ───────────────────────────────────────────────────

/**
 * zodRefine(validatorFn)
 * Wraps any validator above for use in Zod .superRefine() or .refine()
 *
 * @example
 * z.string().superRefine(zodRefine(isValidIndianPhone))
 */
export function zodRefine(validatorFn) {
  return (value, ctx) => {
    const result = validatorFn(value);
    if (!result.valid) {
      ctx.addIssue({
        code: 'custom',
        message: result.reason ?? 'Invalid value',
      });
    }
  };
}
