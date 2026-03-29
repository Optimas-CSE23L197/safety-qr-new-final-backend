import { getEmail } from '#infrastructure/email/email.index.js';
import { logger } from '#config/logger.js';
import { stripHtml } from 'string-strip-html'; // optional helper

export const sendEmailNotification = async ({ to, subject, html, text, meta = {} }) => {
  if (!to || !subject || !html) {
    logger.warn({ meta }, '[email] Missing fields — skipping');
    return { success: false, error: 'Missing required fields' };
  }

  const start = Date.now();
  try {
    const email = getEmail();
    const plainText = text || stripHtml(html).result;

    const result = await email.send({ to, subject, html, text: plainText });

    logger.info(
      { to, subject, latencyMs: Date.now() - start, providerRef: result?.id, ...meta },
      '[email] Email sent'
    );
    return { success: true, providerRef: result?.id };
  } catch (err) {
    logger.error(
      { err: err.message, to, subject, latencyMs: Date.now() - start, ...meta },
      '[email] Email failed'
    );
    return { success: false, error: err.message };
  }
};
