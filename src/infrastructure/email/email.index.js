import { BrevoAdapter } from './brevo.adapter.js';
// import { SesAdapter } from './ses.adapter.js'; // uncomment when AWS SES approved
import { EmailProvider } from './email.provider.js';

// ── Active provider ──────────────────────────────────────
// Switch this one line to change provider:
// BrevoAdapter  → current (free tier, no SES approval needed)
// SesAdapter    → when AWS approves
const ActiveAdapter = BrevoAdapter;
// ─────────────────────────────────────────────────────────

let emailInstance = null;

export function initializeEmail(config = {}) {
  if (!emailInstance) {
    emailInstance = new ActiveAdapter(config);
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
