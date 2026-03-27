import { ResendAdapter } from './resend.adapter.js';
import { EmailProvider } from './email.provider.js';

// ---------------------------------------------------------------------------
// Email Templates
// ---------------------------------------------------------------------------
export const EMAIL_TEMPLATES = {
  WELCOME: {
    html: `
      <div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto;">
        <h1>Welcome to RESQID!</h1>
        <p>Hello {{name}},</p>
        <p>Your account has been successfully created. You can now manage your child's safety profile.</p>
        <p>Get started by adding your child's information and emergency contacts.</p>
        <a href="{{dashboardUrl}}"
           style="display: inline-block; padding: 10px 20px; background-color: #4CAF50;
                  color: white; text-decoration: none; border-radius: 5px;">
          Go to Dashboard
        </a>
      </div>
    `,
    text: 'Welcome to RESQID! Hello {{name}}, your account has been successfully created.',
  },

  EMERGENCY_ALERT: {
    html: `
      <div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto;">
        <h1 style="color: #ff4444;">⚠️ Emergency Alert</h1>
        <p><strong>Your child {{studentName}}'s QR code has been scanned.</strong></p>
        <p><strong>Time:</strong> {{timestamp}}</p>
        <p><strong>Location:</strong> {{location}}</p>
        <p><strong>Message from scanner:</strong> {{message}}</p>
        <p>Please check on your child immediately.</p>
        <a href="{{emergencyUrl}}"
           style="display: inline-block; padding: 10px 20px; background-color: #ff4444;
                  color: white; text-decoration: none; border-radius: 5px;">
          View Details
        </a>
      </div>
    `,
    text: "EMERGENCY ALERT: Your child {{studentName}}'s QR code was scanned at {{timestamp}}. Please check the RESQID app immediately.",
  },

  OTP: {
    html: `
      <div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto;">
        <h2>Your Verification Code</h2>
        <p>Use the code below to complete your sign-in:</p>
        <div style="font-size: 32px; font-weight: bold; padding: 20px;
                    background-color: #f0f0f0; text-align: center; letter-spacing: 5px;">
          {{otp}}
        </div>
        <p>This code expires in <strong>10 minutes</strong>.</p>
        <p>If you did not request this, you can safely ignore this email.</p>
      </div>
    `,
    text: 'Your RESQID verification code is {{otp}}. It expires in 10 minutes.',
  },
};

// ---------------------------------------------------------------------------
// Singleton
// ---------------------------------------------------------------------------
let emailInstance = null;

export function initializeEmail(config = {}) {
  if (!emailInstance) {
    const adapter = new ResendAdapter(config);
    for (const [name, template] of Object.entries(EMAIL_TEMPLATES)) {
      adapter.registerTemplate(name, template);
    }
    emailInstance = adapter;
  }
  return emailInstance;
}

export function getEmail() {
  if (!emailInstance) {
    throw new Error('[Email] Not initialized. Call initializeEmail() before use.');
  }
  return emailInstance;
}

export { EmailProvider, ResendAdapter };
