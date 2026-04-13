// =============================================================================
// modules/scan/scan.redirect.controller.js — RESQID
//
// Handles redirect endpoints for calls and WhatsApp.
// Decrypts phone numbers and issues 302 redirects.
// Phone numbers NEVER appear in HTML or API responses.
// =============================================================================

import { asyncHandler } from '#shared/response/asyncHandler.js';
import { decryptField } from '#shared/security/encryption.js';
import { prisma } from '#config/prisma.js';
import { logger } from '#config/logger.js';
import { decodeScanCode } from '#services/token/token.helpers.js';
import { escapeHtml as esc } from '#shared/security/escapeHtml.js';

// =============================================================================
// HELPER — Find token by UUID or scan code
// =============================================================================
async function findTokenByIdOrCode(token) {
  // Try UUID first (id field)
  let tokenRecord = await prisma.token.findUnique({
    where: { id: token },
    select: { id: true, status: true, expires_at: true, school_id: true },
  });

  // If not found, try by token_hash (64-char hex)
  if (!tokenRecord && token && token.length === 64) {
    tokenRecord = await prisma.token.findFirst({
      where: { token_hash: token },
      select: { id: true, status: true, expires_at: true, school_id: true },
    });
  }

  // If still not found and looks like scan code (43 chars), decode it to UUID
  if (!tokenRecord && token && token.length === 43) {
    try {
      const decodedUuid = decodeScanCode(token);
      console.log('[findTokenByIdOrCode] Decoded base62 to UUID:', decodedUuid);
      tokenRecord = await prisma.token.findUnique({
        where: { id: decodedUuid },
        select: { id: true, status: true, expires_at: true, school_id: true },
      });
    } catch (err) {
      console.log('[findTokenByIdOrCode] Failed to decode base62:', err.message);
    }
  }

  return tokenRecord;
}

// =============================================================================
// CALL CONTACT — Redirect to tel:
// =============================================================================
export const callContact = asyncHandler(async (req, res) => {
  const { contactId, token } = req.params;

  const tokenRecord = await findTokenByIdOrCode(token);

  if (!tokenRecord || tokenRecord.status === 'REVOKED') {
    return res.status(404).json({ error: 'Invalid token' });
  }

  if (tokenRecord.expires_at && tokenRecord.expires_at < new Date()) {
    return res.status(404).json({ error: 'Token expired' });
  }

  const contact = await prisma.emergencyContact.findUnique({
    where: { id: contactId, is_active: true },
    select: { phone_encrypted: true, name: true },
  });

  if (!contact?.phone_encrypted) {
    return res.status(404).json({ error: 'Contact not found' });
  }

  try {
    const phone = decryptField(contact.phone_encrypted);

    // Return HTML that auto-triggers the dialer
    res.send(`
      <!DOCTYPE html>
      <html>
        <head>
          <meta charset="UTF-8">
          <meta name="viewport" content="width=device-width, initial-scale=1.0">
          <title>Calling...</title>
          <style>
            body {
              margin: 0;
              min-height: 100vh;
              background: #0a0f1e;
              display: flex;
              align-items: center;
              justify-content: center;
              font-family: system-ui, -apple-system, sans-serif;
            }
            .container {
              text-align: center;
              padding: 24px;
            }
            .spinner {
              width: 48px;
              height: 48px;
              border: 3px solid rgba(232, 69, 69, 0.2);
              border-top-color: #e84545;
              border-radius: 50%;
              animation: spin 0.8s linear infinite;
              margin: 0 auto 20px;
            }
            @keyframes spin {
              to { transform: rotate(360deg); }
            }
            .message {
              color: #f1f5f9;
              font-size: 16px;
              margin-bottom: 8px;
            }
            .number {
              color: #e84545;
              font-size: 20px;
              font-weight: 600;
              margin-bottom: 20px;
            }
            .fallback {
              color: #64748b;
              font-size: 14px;
            }
            .fallback a {
              color: #3b82f6;
              text-decoration: none;
            }
          </style>
        </head>
        <body>
          <div class="container">
            <div class="spinner"></div>
            <div class="message">Opening dialer for</div>
            <div class="number">${phone}</div>
            <div class="fallback">
              <a href="tel:${phone}">Tap here if dialer doesn't open</a>
            </div>
          </div>
          <script>
            // Try multiple methods to open dialer
            window.location.href = 'tel:${phone}';
            setTimeout(() => {
              // Fallback after 1 second
              if (!document.hidden) {
                window.location.href = 'tel:${phone}';
              }
            }, 1000);
          </script>
        </body>
      </html>
    `);
  } catch (err) {
    logger.error({ err: err.message, contactId }, '[redirect] Decrypt failed');
    return res.status(500).json({ error: 'Unable to process request' });
  }
});

// =============================================================================
// WHATSAPP CONTACT — Redirect to wa.me
// =============================================================================
export const whatsappContact = asyncHandler(async (req, res) => {
  const { contactId, token } = req.params;

  const tokenRecord = await findTokenByIdOrCode(token);

  if (!tokenRecord || tokenRecord.status === 'REVOKED') {
    return res.status(404).json({ error: 'Invalid token' });
  }

  if (tokenRecord.expires_at && tokenRecord.expires_at < new Date()) {
    return res.status(404).json({ error: 'Token expired' });
  }

  const contact = await prisma.emergencyContact.findUnique({
    where: { id: contactId, is_active: true },
    select: { phone_encrypted: true, name: true },
  });

  if (!contact?.phone_encrypted) {
    logger.warn({ contactId, token }, '[redirect] Contact not found');
    return res.status(404).json({ error: 'Contact not found' });
  }

  try {
    const phone = decryptField(contact.phone_encrypted).replace(/\D/g, '');
    logger.info({ contactId, token: token.slice(0, 8) }, '[redirect] WhatsApp initiated');
    return res.redirect(302, `https://wa.me/${phone}`);
  } catch (err) {
    logger.error({ err: err.message, contactId }, '[redirect] Decrypt failed');
    return res.status(500).json({ error: 'Unable to process request' });
  }
});

// =============================================================================
// CALL SCHOOL — Redirect to tel:
// =============================================================================
export const callSchool = asyncHandler(async (req, res) => {
  const { token } = req.params;

  const tokenRecord = await findTokenByIdOrCode(token);

  if (!tokenRecord || tokenRecord.status === 'REVOKED') {
    return res.status(404).json({ error: 'Invalid token' });
  }

  if (tokenRecord.expires_at && tokenRecord.expires_at < new Date()) {
    return res.status(404).json({ error: 'Token expired' });
  }

  const school = await prisma.school.findUnique({
    where: { id: tokenRecord.school_id },
    select: { phone: true, name: true },
  });

  const phone = school?.phone;
  if (!phone) {
    return res.status(404).json({ error: 'School phone not available' });
  }

  // Return HTML that auto-triggers the dialer
  res.send(`
    <!DOCTYPE html>
    <html>
      <head>
        <meta charset="UTF-8">
        <meta name="viewport" content="width=device-width, initial-scale=1.0">
        <title>Calling School...</title>
        <style>
          body {
            margin: 0;
            min-height: 100vh;
            background: #0a0f1e;
            display: flex;
            align-items: center;
            justify-content: center;
            font-family: system-ui, -apple-system, sans-serif;
          }
          .container {
            text-align: center;
            padding: 24px;
          }
          .spinner {
            width: 48px;
            height: 48px;
            border: 3px solid rgba(59, 130, 246, 0.2);
            border-top-color: #3b82f6;
            border-radius: 50%;
            animation: spin 0.8s linear infinite;
            margin: 0 auto 20px;
          }
          @keyframes spin {
            to { transform: rotate(360deg); }
          }
          .message {
            color: #f1f5f9;
            font-size: 16px;
            margin-bottom: 8px;
          }
          .school-name {
            color: #3b82f6;
            font-size: 18px;
            font-weight: 600;
            margin-bottom: 8px;
          }
          .number {
            color: #e84545;
            font-size: 20px;
            font-weight: 600;
            margin-bottom: 20px;
          }
          .fallback {
            color: #64748b;
            font-size: 14px;
          }
          .fallback a {
            color: #3b82f6;
            text-decoration: none;
          }
        </style>
      </head>
      <body>
        <div class="container">
          <div class="spinner"></div>
          <div class="message">Calling</div>
          <div class="school-name">${esc(school.name)}</div>
          <div class="number">${phone}</div>
          <div class="fallback">
            <a href="tel:${phone}">Tap here if dialer doesn't open</a>
          </div>
        </div>
        <script>
          window.location.href = 'tel:${phone}';
          setTimeout(() => {
            if (!document.hidden) {
              window.location.href = 'tel:${phone}';
            }
          }, 1000);
        </script>
      </body>
    </html>
  `);
});

// =============================================================================
// CALL DOCTOR — Redirect to tel:
// =============================================================================
export const callDoctor = asyncHandler(async (req, res) => {
  const { token } = req.params;

  const tokenRecord = await findTokenByIdOrCode(token);

  if (!tokenRecord || tokenRecord.status === 'REVOKED') {
    return res.status(404).json({ error: 'Invalid token' });
  }

  if (tokenRecord.expires_at && tokenRecord.expires_at < new Date()) {
    return res.status(404).json({ error: 'Token expired' });
  }

  const tokenWithStudent = await prisma.token.findUnique({
    where: { id: tokenRecord.id },
    select: {
      student: {
        select: {
          emergency: {
            select: { doctor_phone_encrypted: true, doctor_name: true },
          },
        },
      },
    },
  });

  const encryptedPhone = tokenWithStudent?.student?.emergency?.doctor_phone_encrypted;
  if (!encryptedPhone) {
    return res.status(404).json({ error: 'Doctor phone not available' });
  }

  try {
    const phone = decryptField(encryptedPhone);

    res.send(`
      <!DOCTYPE html>
      <html>
        <head>
          <meta charset="UTF-8">
          <meta name="viewport" content="width=device-width, initial-scale=1.0">
          <title>Calling Doctor...</title>
          <style>
            body {
              margin: 0;
              min-height: 100vh;
              background: #0a0f1e;
              display: flex;
              align-items: center;
              justify-content: center;
              font-family: system-ui, -apple-system, sans-serif;
            }
            .container {
              text-align: center;
              padding: 24px;
            }
            .spinner {
              width: 48px;
              height: 48px;
              border: 3px solid rgba(16, 185, 129, 0.2);
              border-top-color: #10b981;
              border-radius: 50%;
              animation: spin 0.8s linear infinite;
              margin: 0 auto 20px;
            }
            @keyframes spin {
              to { transform: rotate(360deg); }
            }
            .message {
              color: #f1f5f9;
              font-size: 16px;
              margin-bottom: 8px;
            }
            .number {
              color: #10b981;
              font-size: 20px;
              font-weight: 600;
              margin-bottom: 20px;
            }
            .fallback {
              color: #64748b;
              font-size: 14px;
            }
            .fallback a {
              color: #10b981;
              text-decoration: none;
            }
          </style>
        </head>
        <body>
          <div class="container">
            <div class="spinner"></div>
            <div class="message">Calling Doctor</div>
            <div class="number">${phone}</div>
            <div class="fallback">
              <a href="tel:${phone}">Tap here if dialer doesn't open</a>
            </div>
          </div>
          <script>
            window.location.href = 'tel:${phone}';
            setTimeout(() => {
              if (!document.hidden) {
                window.location.href = 'tel:${phone}';
              }
            }, 1000);
          </script>
        </body>
      </html>
    `);
  } catch (err) {
    logger.error({ err: err.message, token }, '[redirect] Doctor decrypt failed');
    return res.status(500).json({ error: 'Unable to process request' });
  }
});
