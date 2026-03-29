import { getSms } from '#infrastructure/sms/sms.index.js';
import { logger } from '#config/logger.js';

export const sendSmsNotification = async ({ to, body, templateId = null, meta = {} }) => {
  if (!to || !body) {
    logger.warn({ meta }, '[sms] Missing fields — skipping');
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

    const result = await sms.send(to, body, templateId ? { templateId } : {});

    logger.info(
      { to, latencyMs: Date.now() - start, providerRef: result?.messageId, ...meta },
      '[sms] SMS sent'
    );
    return { success: true, providerRef: result?.messageId };
  } catch (err) {
    logger.error(
      { err: err.message, to, latencyMs: Date.now() - start, ...meta },
      '[sms] SMS failed'
    );
    return { success: false, error: err.message };
  }
};
