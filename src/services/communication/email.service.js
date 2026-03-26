// =============================================================================
// email.service.js — RESQID
// Environment-aware email service (DEV logs only, PROD sends real emails)
// =============================================================================

import { logger } from "../../config/logger.js";

const NODE_ENV = process.env.NODE_ENV || "development";
const IS_PRODUCTION = NODE_ENV === "production";

// Email configuration (from env)
const EMAIL_CONFIG = {
  host: process.env.SMTP_HOST || "smtp.gmail.com",
  port: parseInt(process.env.SMTP_PORT || "587"),
  secure: process.env.SMTP_SECURE === "true",
  auth: {
    user: process.env.SMTP_USER,
    pass: process.env.SMTP_PASS,
  },
  from: process.env.EMAIL_FROM || "noreply@resqid.com",
  fromName: process.env.EMAIL_FROM_NAME || "ResQID",
};

// Lazy load nodemailer only in production (optimization)
let transporter = null;

const getTransporter = async () => {
  if (!IS_PRODUCTION) return null;
  if (transporter) return transporter;

  try {
    const nodemailer = await import("nodemailer");
    transporter = nodemailer.default.createTransport(EMAIL_CONFIG);
    logger.info({ msg: "Email transporter initialized" });
    return transporter;
  } catch (error) {
    logger.error({
      msg: "Failed to initialize email transporter",
      error: error.message,
    });
    return null;
  }
};

/**
 * Send an email
 * @param {string} to - Recipient email address
 * @param {string} subject - Email subject
 * @param {string} html - HTML content
 * @param {string} text - Plain text content (optional)
 * @returns {Promise<{success: boolean, messageId?: string, simulated?: boolean}>}
 */
export const sendEmail = async (to, subject, html, text = null) => {
  // Validate input
  if (!to || !subject || !html) {
    throw new Error("Missing required email parameters: to, subject, html");
  }

  // Email format validation
  const emailRegex = /^[^\s@]+@([^\s@]+\.)+[^\s@]+$/;
  if (!emailRegex.test(to)) {
    throw new Error(`Invalid email address: ${to}`);
  }

  // Sanitize subject (prevent injection)
  const sanitizedSubject = subject.replace(/[\r\n]/g, "").slice(0, 200);

  // DEVELOPMENT MODE: Log only
  if (!IS_PRODUCTION) {
    logger.info({
      msg: "[DEV] Email would send:",
      to,
      subject: sanitizedSubject,
      htmlLength: html.length,
      text: text ? text.slice(0, 200) : null,
    });
    return {
      success: true,
      simulated: true,
      messageId: `dev-${Date.now()}`,
      to,
      subject: sanitizedSubject,
    };
  }

  // PRODUCTION MODE: Send real email
  try {
    const transporterInstance = await getTransporter();
    if (!transporterInstance) {
      throw new Error("Email transporter not available");
    }

    const mailOptions = {
      from: `"${EMAIL_CONFIG.fromName}" <${EMAIL_CONFIG.from}>`,
      to,
      subject: sanitizedSubject,
      html,
      ...(text && { text }),
    };

    const info = await transporterInstance.sendMail(mailOptions);

    logger.info({
      msg: "Email sent successfully",
      to,
      subject: sanitizedSubject,
      messageId: info.messageId,
    });

    return {
      success: true,
      messageId: info.messageId,
      to,
      subject: sanitizedSubject,
    };
  } catch (error) {
    logger.error({
      msg: "Failed to send email",
      to,
      subject: sanitizedSubject,
      error: error.message,
    });
    throw new Error(`Email delivery failed: ${error.message}`);
  }
};

/**
 * Send templated email using predefined template
 * @param {string} to - Recipient email
 * @param {string} template - Template name
 * @param {object} data - Template variables
 * @returns {Promise<{success: boolean, messageId?: string}>}
 */
export const sendTemplatedEmail = async (to, template, data = {}) => {
  // This would integrate with your email template system
  // For now, we'll use a simple placeholder
  const templates = {
    ORDER_CREATED: {
      subject: "Order Created - #{orderNumber}",
      html: "<h1>Order Created</h1><p>Your order #{orderNumber} has been created.</p>",
    },
    ORDER_APPROVED: {
      subject: "Order Approved - #{orderNumber}",
      html: "<h1>Order Approved</h1><p>Your order #{orderNumber} has been approved.</p>",
    },
    ADVANCE_INVOICE_READY: {
      subject: "Advance Invoice Ready - #{orderNumber}",
      html: "<h1>Advance Invoice Ready</h1><p>Invoice #{invoiceNumber} for ₹#{amount} is ready.</p>",
    },
    PAYMENT_RECEIVED: {
      subject: "Payment Received - #{orderNumber}",
      html: "<h1>Payment Received</h1><p>Payment of ₹#{amount} received for order #{orderNumber}.</p>",
    },
    SHIPPED: {
      subject: "Order Shipped - #{orderNumber}",
      html: "<h1>Order Shipped</h1><p>Your order #{orderNumber} has been shipped. Track: #{trackingUrl}</p>",
    },
    DELIVERED: {
      subject: "Order Delivered - #{orderNumber}",
      html: "<h1>Order Delivered</h1><p>Your order #{orderNumber} has been delivered.</p>",
    },
    ORDER_COMPLETED: {
      subject: "Order Completed - #{orderNumber}",
      html: "<h1>Order Completed</h1><p>Thank you for your order #{orderNumber}.</p>",
    },
  };

  const templateDef = templates[template];
  if (!templateDef) {
    throw new Error(`Unknown email template: ${template}`);
  }

  // Replace placeholders
  let subject = templateDef.subject;
  let html = templateDef.html;

  for (const [key, value] of Object.entries(data)) {
    const regex = new RegExp(`#{${key}}`, "g");
    subject = subject.replace(regex, value);
    html = html.replace(regex, value);
  }

  return sendEmail(to, subject, html);
};

/**
 * Send bulk emails (batch processing)
 * @param {Array<{to: string, subject: string, html: string}>} emails
 * @returns {Promise<Array<{to: string, success: boolean, error?: string}>>}
 */
export const sendBulkEmails = async (emails) => {
  const results = [];

  for (const email of emails) {
    try {
      const result = await sendEmail(email.to, email.subject, email.html);
      results.push({
        to: email.to,
        success: true,
        messageId: result.messageId,
      });
    } catch (error) {
      results.push({ to: email.to, success: false, error: error.message });
    }
  }

  return results;
};

/**
 * Check email service health
 */
export const checkEmailHealth = async () => {
  if (!IS_PRODUCTION) {
    return { status: "ok", mode: "development", simulated: true };
  }

  try {
    const transporterInstance = await getTransporter();
    if (!transporterInstance) {
      return { status: "error", error: "Transporter not initialized" };
    }
    await transporterInstance.verify();
    return { status: "ok", mode: "production" };
  } catch (error) {
    return { status: "error", error: error.message };
  }
};

export default {
  sendEmail,
  sendTemplatedEmail,
  sendBulkEmails,
  checkEmailHealth,
};
