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

// =============================================================================
// CALL CONTACT — Redirect to tel:
// =============================================================================
export const callContact = asyncHandler(async (req, res) => {
  const { contactId, token } = req.params;

  // Verify token exists and is valid
  const tokenRecord = await prisma.token.findUnique({
    where: { id: token },
    select: { id: true, status: true, expires_at: true },
  });

  if (!tokenRecord || tokenRecord.status === 'REVOKED') {
    return res.status(404).json({ error: 'Invalid token' });
  }

  if (tokenRecord.expires_at && tokenRecord.expires_at < new Date()) {
    return res.status(404).json({ error: 'Token expired' });
  }

  // Get contact phone
  const contact = await prisma.emergencyContact.findUnique({
    where: { id: contactId, is_active: true },
    select: { phone_encrypted: true, name: true },
  });

  if (!contact?.phone_encrypted) {
    logger.warn({ contactId, token }, '[redirect] Contact not found');
    return res.status(404).json({ error: 'Contact not found' });
  }

  try {
    const phone = decryptField(contact.phone_encrypted);
    logger.info({ contactId, token: token.slice(0, 8) }, '[redirect] Call initiated');
    return res.redirect(302, `tel:${phone}`);
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

  const tokenRecord = await prisma.token.findUnique({
    where: { id: token },
    select: { id: true, status: true, expires_at: true },
  });

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

  const tokenRecord = await prisma.token.findUnique({
    where: { id: token },
    select: {
      id: true,
      status: true,
      expires_at: true,
      school: { select: { phone: true, name: true } },
    },
  });

  if (!tokenRecord || tokenRecord.status === 'REVOKED') {
    return res.status(404).json({ error: 'Invalid token' });
  }

  if (tokenRecord.expires_at && tokenRecord.expires_at < new Date()) {
    return res.status(404).json({ error: 'Token expired' });
  }

  const phone = tokenRecord.school?.phone;
  if (!phone) {
    return res.status(404).json({ error: 'School phone not available' });
  }

  logger.info({ token: token.slice(0, 8) }, '[redirect] School call initiated');
  return res.redirect(302, `tel:${phone}`);
});

// =============================================================================
// CALL DOCTOR — Redirect to tel:
// =============================================================================
export const callDoctor = asyncHandler(async (req, res) => {
  const { token } = req.params;

  const tokenRecord = await prisma.token.findUnique({
    where: { id: token },
    select: {
      id: true,
      status: true,
      expires_at: true,
      student: {
        select: {
          emergency: {
            select: { doctor_phone_encrypted: true, doctor_name: true },
          },
        },
      },
    },
  });

  if (!tokenRecord || tokenRecord.status === 'REVOKED') {
    return res.status(404).json({ error: 'Invalid token' });
  }

  if (tokenRecord.expires_at && tokenRecord.expires_at < new Date()) {
    return res.status(404).json({ error: 'Token expired' });
  }

  const encryptedPhone = tokenRecord.student?.emergency?.doctor_phone_encrypted;
  if (!encryptedPhone) {
    return res.status(404).json({ error: 'Doctor phone not available' });
  }

  try {
    const phone = decryptField(encryptedPhone);
    logger.info({ token: token.slice(0, 8) }, '[redirect] Doctor call initiated');
    return res.redirect(302, `tel:${phone}`);
  } catch (err) {
    logger.error({ err: err.message, token }, '[redirect] Doctor decrypt failed');
    return res.status(500).json({ error: 'Unable to process request' });
  }
});
