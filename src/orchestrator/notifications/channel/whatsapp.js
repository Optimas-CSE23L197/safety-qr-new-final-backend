// import { getSms } from '#infrastructure/sms/sms.index.js';
// import { logger } from '#config/logger.js';

// export const sendWhatsAppNotification = async ({ to, body, templateId, meta = {} }) => {
//   if (!to || !body) {
//     logger.warn({ meta }, '[whatsapp] Missing fields — skipping');
//     return { success: false, error: 'Missing required fields' };
//   }

//   const start = Date.now();
//   try {
//     const sms = getSms();
//     // Using SMS send for now
//     // When MSG91 WhatsApp API configured → swap this line only
//     const result = await sms.send(to, body);

//     logger.info(
//       { to, latencyMs: Date.now() - start, providerRef: result?.messageId, ...meta },
//       '[whatsapp] WhatsApp sent'
//     );
//     return { success: true, providerRef: result?.messageId };
//   } catch (err) {
//     logger.error(
//       { err: err.message, to, latencyMs: Date.now() - start, ...meta },
//       '[whatsapp] WhatsApp failed'
//     );
//     return { success: false, error: err.message };
//   }
// };
