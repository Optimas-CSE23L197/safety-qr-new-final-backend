// =============================================================================
// dateTime.js — RESQID
// All date/time utilities — IST-aware (Asia/Kolkata)
// Uses date-fns — no dayjs (removed duplicate in package.json)
//
// Key uses:
//   - Token expiry calculation
//   - Card renewal reminders (30/15/7/1 day warnings)
//   - School hours check (AFTER_HOURS anomaly)
//   - Scan log timestamps
// =============================================================================

import {
  addDays,
  addMonths,
  addYears,
  addHours,
  addMinutes,
  subDays,
  subMonths,
  differenceInDays,
  differenceInMinutes,
  differenceInHours,
  isBefore,
  isAfter,
  isToday,
  isEqual,
  startOfDay,
  endOfDay,
  startOfWeek,
  endOfWeek,
  format,
  parseISO,
  formatDistanceToNow,
  getDay,
  getHours,
  getMinutes,
} from "date-fns";
import { toZonedTime, fromZonedTime, formatInTimeZone } from "date-fns-tz";

const IST_TZ = "Asia/Kolkata";

// ─── Now ──────────────────────────────────────────────────────────────────────

export function nowUtc() {
  return new Date();
}
export function nowIst() {
  return toZonedTime(new Date(), IST_TZ);
}
export function nowIstStr() {
  return formatInTimeZone(new Date(), IST_TZ, "yyyy-MM-dd HH:mm:ss");
}

// ─── Token / Card Expiry ──────────────────────────────────────────────────────

/**
 * tokenExpiryDate(months = 12)
 * Calculate expiry from now — used when generating new tokens
 */
export function tokenExpiryDate(months = 12) {
  return addMonths(new Date(), months);
}

/**
 * isExpired(date)
 * True if the given date is in the past
 */
export function isExpired(date) {
  if (!date) return false;
  return isBefore(new Date(date), new Date());
}

/**
 * expiresInDays(date)
 * How many days until expiry — negative if already expired
 */
export function expiresInDays(date) {
  if (!date) return null;
  return differenceInDays(new Date(date), new Date());
}

/**
 * isExpiringWithinDays(date, days)
 * True if expiry is within `days` days — for renewal reminders
 * SchoolSettings.renewal_reminder_days = [30, 15, 7, 1]
 */
export function isExpiringWithinDays(date, days) {
  if (!date) return false;
  const d = expiresInDays(date);
  return d !== null && d >= 0 && d <= days;
}

/**
 * shouldSendRenewalReminder(expiryDate, reminderDays)
 * Returns the reminder window matched, or null
 * reminderDays: [30, 15, 7, 1] from SchoolSettings
 */
export function shouldSendRenewalReminder(
  expiryDate,
  reminderDays = [30, 15, 7, 1],
) {
  const daysLeft = expiresInDays(expiryDate);
  if (daysLeft === null || daysLeft < 0) return null;
  const matched = reminderDays.find((d) => daysLeft === d);
  return matched ?? null;
}

// ─── School Hours (AFTER_HOURS anomaly) ───────────────────────────────────────

/**
 * isWithinSchoolHours(schoolSettings, dateToCheck?)
 * Returns true if given time is within school's configured hours
 * Used by anomaly detection — scans outside hours → flag AFTER_HOURS
 *
 * @param {{ school_hours_start: string, school_hours_end: string, school_days: number[], timezone: string }} settings
 * @param {Date} [date] - defaults to now
 */
export function isWithinSchoolHours(settings, date = new Date()) {
  const {
    school_hours_start,
    school_hours_end,
    school_days,
    timezone = IST_TZ,
  } = settings;

  if (!school_hours_start || !school_hours_end) return true; // no config = no anomaly

  const zoned = toZonedTime(date, timezone);
  const dayOfWeek = getDay(zoned); // 0=Sun 1=Mon ... 6=Sat
  const normalizedDay = dayOfWeek === 0 ? 7 : dayOfWeek; // schema: 1=Mon, 7=Sun

  // Check if it's a school day
  if (!school_days.includes(normalizedDay)) return false;

  // Parse school hours
  const [startH, startM] = school_hours_start.split(":").map(Number);
  const [endH, endM] = school_hours_end.split(":").map(Number);

  const currentMinutes = getHours(zoned) * 60 + getMinutes(zoned);
  const startMinutes = startH * 60 + startM;
  const endMinutes = endH * 60 + endM;

  return currentMinutes >= startMinutes && currentMinutes <= endMinutes;
}

// ─── OTP / Session Expiry ─────────────────────────────────────────────────────

export function otpExpiresAt(minutes = 10) {
  return addMinutes(new Date(), minutes);
}

export function sessionExpiresAt(days = 30) {
  return addDays(new Date(), days);
}

// ─── Formatting ───────────────────────────────────────────────────────────────

/**
 * formatDateIst(date, fmt?)
 * Format a UTC date in IST for display
 */
export function formatDateIst(date, fmt = "dd MMM yyyy") {
  if (!date) return null;
  return formatInTimeZone(new Date(date), IST_TZ, fmt);
}

/**
 * formatDateTimeIst(date)
 * Full datetime in IST
 */
export function formatDateTimeIst(date) {
  if (!date) return null;
  return formatInTimeZone(new Date(date), IST_TZ, "dd MMM yyyy, hh:mm a");
}

/**
 * timeAgo(date)
 * "5 minutes ago", "3 days ago" — for notification timestamps
 */
export function timeAgo(date) {
  if (!date) return null;
  return formatDistanceToNow(new Date(date), { addSuffix: true });
}

// ─── Order Number / Invoice Number Generators ────────────────────────────────

/**
 * generateOrderNumber()
 * Format: ORD-YYYY-NNNN (sequential part handled by caller)
 */
export function orderNumberPrefix() {
  return `ORD-${format(new Date(), "yyyy")}`;
}

export function invoiceNumberPrefix() {
  return `INV-${format(new Date(), "yyyy")}`;
}
