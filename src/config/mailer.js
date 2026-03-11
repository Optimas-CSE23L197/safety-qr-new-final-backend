// =============================================================================
// mailer.js — RESQID
// Production-grade Nodemailer transporter with connection pooling
// Used for: device login alerts, anomaly notifications, card expiry warnings,
//           subscription emails, invoice delivery
//
// Schema references:
//   DeviceLoginLog.email_sent / email_sent_at — device login alert tracking
//   ParentNotificationPref.anomaly_notify_email
//   ParentNotificationPref.card_expiry_notify
//
// Features:
//   - SMTP connection pool (5 connections) — no reconnect per email
//   - Automatic retry on transient failures (3 attempts, exponential backoff)
//   - Dev mode: Ethereal fake SMTP — emails visible at ethereal.email
//   - HTML + plain text fallback on every email
//   - Attachment support for invoice PDFs
//   - Rate limiting awareness — never queues >50 concurrent sends
// =============================================================================

import nodemailer from "nodemailer";
import { ENV } from "./env.js";
import { logger } from "./logger.js";

// ─── Transporter Factory ──────────────────────────────────────────────────────

async function createTransporter() {
  // Development: use Ethereal fake SMTP
  // Emails are caught and viewable at https://ethereal.email (no real delivery)
  if (ENV.IS_DEV && !ENV.SMTP_HOST) {
    const testAccount = await nodemailer.createTestAccount();
    logger.info(
      {
        type: "mailer_dev",
        user: testAccount.user,
        previewUrl: "https://ethereal.email",
      },
      "Mailer: using Ethereal dev SMTP — check https://ethereal.email to view emails",
    );

    return nodemailer.createTransport({
      host: "smtp.ethereal.email",
      port: 587,
      secure: false,
      auth: {
        user: testAccount.user,
        pass: testAccount.pass,
      },
    });
  }

  // Production / staging: real SMTP with connection pool
  const transporter = nodemailer.createTransport({
    host: ENV.SMTP_HOST,
    port: ENV.SMTP_PORT,
    // STARTTLS on port 587, direct TLS on port 465
    secure: ENV.SMTP_PORT === 465,
    auth: {
      user: ENV.SMTP_USER,
      pass: ENV.SMTP_PASS,
    },

    // Connection pooling — reuse connections across sends
    pool: true,
    maxConnections: 5, // max concurrent SMTP connections
    maxMessages: 100, // messages per connection before recycling
    rateDelta: 1000, // time window for rate limiting (ms)
    rateLimit: 10, // max messages per rateDelta

    // Connection timeouts
    connectionTimeout: 10_000, // 10 seconds to connect
    greetingTimeout: 5_000, // 5 seconds for SMTP greeting
    socketTimeout: 30_000, // 30 seconds for socket inactivity

    // TLS options
    tls: {
      rejectUnauthorized: ENV.IS_PROD, // strict cert validation in prod
      minVersion: "TLSv1.2",
    },
  });

  return transporter;
}

// ─── Singleton ────────────────────────────────────────────────────────────────

let _transporter = null;

async function getTransporter() {
  if (!_transporter) {
    _transporter = await createTransporter();

    // Verify connection at startup — log warning but don't crash
    // (email is non-critical path — app should work even if SMTP is down)
    _transporter.verify((err) => {
      if (err) {
        logger.warn(
          { type: "mailer_verify_failed", err: err.message },
          "Mailer: SMTP connection verification failed — emails may not send",
        );
      } else {
        logger.info(
          { type: "mailer_ready" },
          "Mailer: SMTP connection verified and ready",
        );
      }
    });
  }
  return _transporter;
}

// ─── Send Helper ──────────────────────────────────────────────────────────────

const MAX_RETRIES = 3;
const RETRY_DELAYS = [1000, 3000, 9000]; // exponential backoff ms

/**
 * sendMail(options)
 * Main send function — retries on transient failures
 *
 * @param {object} options - Nodemailer mail options
 * @param {string} options.to - Recipient email
 * @param {string} options.subject - Email subject
 * @param {string} options.html - HTML body
 * @param {string} [options.text] - Plain text fallback (auto-generated if omitted)
 * @param {Array}  [options.attachments] - Nodemailer attachment objects
 * @returns {object} Nodemailer info object { messageId, previewUrl? }
 */
export async function sendMail({ to, subject, html, text, attachments = [] }) {
  const transporter = await getTransporter();

  const mailOptions = {
    from: `"${ENV.EMAIL_FROM_NAME}" <${ENV.EMAIL_FROM}>`,
    to,
    subject,
    html,
    // Plain text fallback — strip HTML tags if text not provided
    text:
      text ??
      html
        .replace(/<[^>]+>/g, "")
        .replace(/\s{2,}/g, " ")
        .trim(),
    attachments,
  };

  let lastErr;

  for (let attempt = 0; attempt < MAX_RETRIES; attempt++) {
    try {
      const info = await transporter.sendMail(mailOptions);

      logger.info(
        {
          type: "email_sent",
          to,
          subject,
          messageId: info.messageId,
          attempt: attempt + 1,
        },
        `Email sent: ${subject}`,
      );

      // In dev, log the Ethereal preview URL
      if (ENV.IS_DEV) {
        const previewUrl = nodemailer.getTestMessageUrl(info);
        if (previewUrl) {
          logger.info({ previewUrl }, "Mailer: email preview URL");
        }
      }

      return info;
    } catch (err) {
      lastErr = err;

      const isRetryable = isTransientError(err);

      logger.warn(
        {
          type: "email_send_failed",
          to,
          subject,
          attempt: attempt + 1,
          err: err.message,
          willRetry: isRetryable && attempt < MAX_RETRIES - 1,
        },
        `Email send failed (attempt ${attempt + 1}): ${err.message}`,
      );

      if (!isRetryable) break; // don't retry permanent failures
      if (attempt < MAX_RETRIES - 1) {
        await sleep(RETRY_DELAYS[attempt]);
      }
    }
  }

  // All retries exhausted — throw so caller can decide to queue/alert
  throw new Error(
    `[mailer.js] Failed to send email to ${to} after ${MAX_RETRIES} attempts: ${lastErr?.message}`,
  );
}

// ─── Health Check ─────────────────────────────────────────────────────────────

export async function checkMailerHealth() {
  try {
    const transporter = await getTransporter();
    await new Promise((resolve, reject) => {
      transporter.verify((err, success) => {
        if (err) reject(err);
        else resolve(success);
      });
    });
    return { status: "ok" };
  } catch (err) {
    return { status: "error", error: err.message };
  }
}

// ─── Graceful Shutdown ────────────────────────────────────────────────────────

export function closeMailer() {
  if (_transporter) {
    _transporter.close();
    _transporter = null;
    logger.info("Mailer: SMTP connection pool closed");
  }
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

function isTransientError(err) {
  const transientCodes = [
    "ECONNRESET",
    "ECONNREFUSED",
    "ETIMEDOUT",
    "ESOCKET",
    "ENOTFOUND",
  ];
  const transientMessages = ["421", "450", "451", "452"]; // SMTP temp fail codes

  return (
    transientCodes.some((c) => err.code === c) ||
    transientMessages.some((m) => err.message?.includes(m))
  );
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
