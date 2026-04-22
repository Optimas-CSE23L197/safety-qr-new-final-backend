// =============================================================================
// infrastructure/email/email.index.js — RESQID
// AWS SES only. ResendAdapter removed from exports (was never imported here).
// Templates are managed in src/templates/ — NOT here.
// =============================================================================

import { SesAdapter } from './ses.adapter.js';
import { EmailProvider } from './email.provider.js';

let emailInstance = null;

export function initializeEmail(config = {}) {
  if (!emailInstance) {
    emailInstance = new SesAdapter(config);
  }
  return emailInstance;
}

export function getEmail() {
  if (!emailInstance) {
    throw new Error('[Email] Not initialized. Call initializeEmail() before use.');
  }
  return emailInstance;
}

export { EmailProvider };
