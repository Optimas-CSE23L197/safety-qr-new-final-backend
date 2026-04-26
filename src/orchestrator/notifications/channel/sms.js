// =============================================================================
// orchestrator/notifications/channel/sms.js — RESQID
// Thin channel wrapper over MSG91Adapter.
// FIXED: Now accepts and passes `variables` for DLT templates.
// =============================================================================

import { getSms } from '#infrastructure/sms/sms.index.js';
import { logger } from '#config/logger.js';

export const sendSmsNotification = async ({
  to,
  body,
  templateId = null,
  variables = null,
  meta = {},
}) => {
  if (!to) {
    logger.warn({ meta }, '[sms] Missing phone number — skipping');
    return { success: false, error: 'Missing required fields' };
  }

  // For DLT templates, either body or variables is required
  if (templateId && !body && !variables) {
    logger.warn({ meta }, '[sms] Template requires body or variables — skipping');
    return { success: false, error: 'Missing template content' };
  }

  // For plain SMS, body is required
  if (!templateId && !body) {
    logger.warn({ meta }, '[sms] Missing message body — skipping');
    return { success: false, error: 'Missing required fields' };
  }

  const start = Date.now();
  try {
    let sms;
    try {
      sms = getSms();
    } catch (err) {
      logger.error({ err: err.message, ...meta }, '[sms] Provider init failed');
      return { success: false, error: 'SMS provider not available' };
    }

    const result = await sms.send(to, body, { templateId, variables });

    logger.info(
      {
        to: to.slice(0, 6) + '…',
        latencyMs: Date.now() - start,
        providerRef: result?.id ?? result?.messageId,
        ...meta,
      },
      '[sms] SMS sent'
    );
    return { success: true, providerRef: result?.id ?? result?.messageId };
  } catch (err) {
    logger.error(
      { err: err.message, to: to.slice(0, 6) + '…', latencyMs: Date.now() - start, ...meta },
      '[sms] SMS failed'
    );
    return { success: false, error: err.message };
  }
};
