// test-email.js
import { initializeEmail, getEmail } from '../src/infrastructure/email/email.index.js';
import EmailChangedEmail from '../src/templates/email/email-changed.jsx';

initializeEmail();

const email = getEmail();
const result = await email.sendReactTemplate(
  EmailChangedEmail,
  {
    parentName: 'Test Parent',
    oldEmail: 'karananimesh144@gmail.com',
    newEmail: 'optimasprime144@gmail.com',
  },
  { to: 'optimasprime144@gmail.com', subject: 'Test Email - RESQID' }
);

console.log('Result:', result);
process.exit(0);
