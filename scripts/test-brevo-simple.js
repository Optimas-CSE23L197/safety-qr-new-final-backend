// scripts/test-brevo-simple.js
import { initializeEmail, getEmail } from '../src/infrastructure/email/email.index.js';

initializeEmail();

const email = getEmail();

// Test simple send first (no React template)
const result = await email.send({
  to: 'karananimesh144@gmail.com',
  subject: 'Test Email from RESQID',
  html: '<h1>Hello!</h1><p>This is a test email from Brevo.</p>',
  text: 'Hello! This is a test email from Brevo.',
});

console.log('Simple send result:', JSON.stringify(result, null, 2));
process.exit(0);
