// =============================================================================
// msg91.js — RESQID
// MSG91 client for OTP delivery and transactional SMS
//
// Schema references:
//   OtpLog.msg91_req_id  — MSG91 request ID for delivery status tracking
//   OtpLog.phone         — recipient phone in E.164 format
//   OtpLog.expires_at    — OTP expiry (enforced in handler, not here)
//   ParentNotificationPref.scan_notify_sms
//   ParentNotificationPref.anomaly_notify_sms
//
// Features:
//   - OTP send via MSG91 Flow API (DLT-compliant)
//   - OTP verify via MSG91 (or local hash check — local preferred)
//   - Transactional SMS for scan/anomaly notifications
//   - Dev mode: mock — OTP is always "123456", logged to console, not sent
//   - Returns msg91_req_id for delivery status tracking
// =============================================================================

import { ENV } from "./env.js";
import { logger } from "./logger.js";

// ─── Constants ────────────────────────────────────────────────────────────────

const MSG91_BASE_URL = "https://control.msg91.com/api/v5";
const REQUEST_TIMEOUT_MS = 10_000; // 10 seconds

// ─── Dev Mock ─────────────────────────────────────────────────────────────────
// In development: skip real API calls, return predictable values
// OTP is always "123456" — set in generateOtp() in encryption.js for dev

const DEV_OTP = "123456";
const DEV_REQ_ID = "dev-mock-req-id";

// ─── OTP Send ─────────────────────────────────────────────────────────────────

/**
 * sendOtp(phone)
 * Send a 6-digit OTP to the given E.164 phone number via MSG91
 *
 * @param {string} phone - E.164 format e.g. "+919876543210"
 * @returns {{ otp: string, msg91ReqId: string }}
 *   otp         — the plaintext OTP (hash and store, never persist plaintext)
 *   msg91ReqId  — store in OtpLog.msg91_req_id for delivery tracking
 */
export async function sendOtp(phone) {
  // Dev mode — skip real API
  if (ENV.IS_DEV && !ENV.MSG91_AUTH_KEY) {
    logger.info(
      { type: "otp_dev_mock", phone, otp: DEV_OTP },
      `MSG91 [DEV]: OTP for ${phone} is ${DEV_OTP} (not sent)`,
    );
    return { otp: DEV_OTP, msg91ReqId: DEV_REQ_ID };
  }

  // Strip + for MSG91 — it expects digits only
  const mobileNumber = phone.replace(/^\+/, "");

  // Generate 6-digit OTP — MSG91 Flow API sends it via template
  const { generateOtp } = await import("./encryption.js");
  const otp = generateOtp(6);

  const payload = {
    template_id: ENV.MSG91_OTP_TEMPLATE_ID,
    mobile: mobileNumber,
    authkey: ENV.MSG91_AUTH_KEY,
    otp,
  };

  const response = await fetchWithTimeout(
    `${MSG91_BASE_URL}/flow/`,
    {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
    },
    REQUEST_TIMEOUT_MS,
  );

  const data = await response.json();

  if (!response.ok || data.type !== "success") {
    logger.error(
      { type: "otp_send_failed", phone, response: data },
      `MSG91: OTP send failed — ${data.message ?? "unknown error"}`,
    );
    throw new Error(`OTP send failed: ${data.message ?? "MSG91 error"}`);
  }

  logger.info(
    { type: "otp_sent", phone, msg91ReqId: data.request_id },
    "MSG91: OTP sent successfully",
  );

  return {
    otp, // hash immediately — never store plaintext
    msg91ReqId: data.request_id, // store in OtpLog.msg91_req_id
  };
}

// ─── Transactional SMS ────────────────────────────────────────────────────────

/**
 * sendSms(phone, message)
 * Send a transactional SMS notification
 * Used for: scan alerts, anomaly alerts
 *
 * @param {string} phone   - E.164 format
 * @param {string} message - SMS body text (keep under 160 chars for single SMS)
 * @returns {string} MSG91 request ID
 */
export async function sendSms(phone, message) {
  if (ENV.IS_DEV && !ENV.MSG91_AUTH_KEY) {
    logger.info(
      { type: "sms_dev_mock", phone, message },
      `MSG91 [DEV]: SMS to ${phone}: "${message}" (not sent)`,
    );
    return DEV_REQ_ID;
  }

  const mobileNumber = phone.replace(/^\+/, "");

  const payload = {
    sender: ENV.MSG91_SENDER_ID,
    route: ENV.MSG91_ROUTE,
    country: "91",
    sms: [
      {
        message,
        to: [mobileNumber],
      },
    ],
  };

  const response = await fetchWithTimeout(
    `${MSG91_BASE_URL}/sendotp.php`,
    {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        authkey: ENV.MSG91_AUTH_KEY,
      },
      body: JSON.stringify(payload),
    },
    REQUEST_TIMEOUT_MS,
  );

  const data = await response.json();

  if (!response.ok || data.type !== "success") {
    logger.error(
      { type: "sms_send_failed", phone, response: data },
      `MSG91: SMS send failed — ${data.message ?? "unknown error"}`,
    );
    throw new Error(`SMS send failed: ${data.message ?? "MSG91 error"}`);
  }

  logger.info(
    { type: "sms_sent", phone, msg91ReqId: data.request_id },
    "MSG91: SMS sent",
  );

  return data.request_id;
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

async function fetchWithTimeout(url, options, timeoutMs) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);

  try {
    const response = await fetch(url, {
      ...options,
      signal: controller.signal,
    });
    return response;
  } catch (err) {
    if (err.name === "AbortError") {
      throw new Error(`MSG91 request timed out after ${timeoutMs}ms`);
    }
    throw err;
  } finally {
    clearTimeout(timer);
  }
}
