// =============================================================================
// infrastructure/email/ses.adapter.js — RESQID
// AWS SES only. React Email for rendering. No Resend, no Nodemailer.
// REMOVED: registerTemplate(), _renderTemplate(), sendTemplate() — dead code.
// ADDED:   sendReactTemplate(Component, props, options) — single render path.
// =============================================================================

import { SESClient, SendEmailCommand } from '@aws-sdk/client-ses';
import { render } from '@react-email/components';
import { EmailProvider } from './email.provider.js';
import { logger } from '#config/logger.js';

export class SesAdapter extends EmailProvider {
  constructor(config = {}) {
    super();
    this.client = new SESClient({
      region: config.AWS_SES_REGION ?? process.env.AWS_SES_REGION ?? 'ap-south-1',
      credentials: {
        accessKeyId: config.AWS_SES_ACCESS_KEY ?? process.env.AWS_SES_ACCESS_KEY,
        secretAccessKey: config.AWS_SES_SECRET_KEY ?? process.env.AWS_SES_SECRET_KEY,
      },
    });
    this.defaultFrom =
      config.FROM_EMAIL ?? process.env.SES_FROM_EMAIL ?? 'RESQID <noreply@getresqid.in>';
  }

  /**
   * Low-level send — accepts pre-rendered html string.
   * All other methods call this internally.
   */
  async send({ to, subject, html, text, from, replyTo }) {
    const source = from ?? this.defaultFrom;
    const recipients = Array.isArray(to) ? to : [to];

    try {
      const command = new SendEmailCommand({
        Source: source,
        Destination: { ToAddresses: recipients },
        Message: {
          Subject: { Data: subject, Charset: 'UTF-8' },
          Body: {
            Html: { Data: html, Charset: 'UTF-8' },
            ...(text && { Text: { Data: text, Charset: 'UTF-8' } }),
          },
        },
        ...(replyTo && { ReplyToAddresses: [replyTo] }),
      });

      const response = await this.client.send(command);
      logger.info({ to: recipients, messageId: response.MessageId }, '[Email] Sent via SES');
      return { success: true, id: response.MessageId };
    } catch (err) {
      logger.error({ to: recipients, error: err.message }, '[Email] SES send failed');
      return { success: false, error: err.message };
    }
  }

  /**
   * Render a React Email component and send via SES.
   * This is the ONLY template path — replaces sendTemplate() entirely.
   *
   * @param {React.ComponentType} Component  — imported from src/templates/email/
   * @param {object}              props      — component props (typed per template)
   * @param {{ to, subject, from?, replyTo? }} options
   *
   * @example
   *   import OtpAdminEmail from '#templates/email/otp-admin.jsx';
   *   await email.sendReactTemplate(OtpAdminEmail, { userName, otpCode }, {
   *     to: 'admin@school.com',
   *     subject: `Your RESQID OTP — ${otpCode}`,
   *   });
   */
  async sendReactTemplate(Component, props = {}, { to, subject, from, replyTo } = {}) {
    try {
      const html = await render(<Component {...props} />);
      const text = await render(<Component {...props} />, { plainText: true });
      return this.send({ to, subject, html, text, from, replyTo });
    } catch (err) {
      logger.error({ error: err.message, to }, '[Email] React template render/send failed');
      return { success: false, error: err.message };
    }
  }

  /**
   * Send the same pre-rendered email to multiple recipients.
   * Renders once, sends N times in parallel.
   */
  async sendBulk(emails) {
    const results = await Promise.allSettled(emails.map(e => this.send(e)));
    return results.map((r, i) =>
      r.status === 'fulfilled'
        ? r.value
        : { success: false, error: r.reason?.message, to: emails[i]?.to }
    );
  }
}

export default SesAdapter;
