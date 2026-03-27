// =============================================================================
// notifications/notification.templates.js
// Template rendering engine for notifications.
// =============================================================================

import { NOTIFICATION_TEMPLATES, NOTIFICATION_EVENTS } from './notification.events.js';

/**
 * Render an email template
 */
export function renderEmailTemplate(event, data) {
  const template = NOTIFICATION_TEMPLATES[event]?.email;
  if (!template) {
    throw new Error(`No email template found for event: ${event}`);
  }

  const subject = interpolate(template.subject, data);
  const body = interpolate(template.body, data);

  return { subject, body };
}

/**
 * Render an SMS template
 */
export function renderSmsTemplate(event, data) {
  const template = NOTIFICATION_TEMPLATES[event]?.sms;
  if (!template) {
    // Fallback to email subject if SMS not defined
    const emailTemplate = NOTIFICATION_TEMPLATES[event]?.email;
    if (emailTemplate) {
      return interpolate(emailTemplate.subject, data);
    }
    throw new Error(`No SMS template found for event: ${event}`);
  }

  return interpolate(template, data);
}

/**
 * Render a push notification template
 */
export function renderPushTemplate(event, data) {
  const template = NOTIFICATION_TEMPLATES[event]?.push;
  if (!template) {
    // Fallback to email subject if push not defined
    const emailTemplate = NOTIFICATION_TEMPLATES[event]?.email;
    if (emailTemplate) {
      return {
        title: interpolate(emailTemplate.subject, data),
        body: interpolate(emailTemplate.body, data).substring(0, 100),
      };
    }
    throw new Error(`No push template found for event: ${event}`);
  }

  return {
    title: interpolate(template.title, data),
    body: interpolate(template.body, data),
  };
}

/**
 * Interpolate template variables
 */
function interpolate(template, data) {
  if (!template) return '';

  let result = template;
  for (const [key, value] of Object.entries(data)) {
    const regex = new RegExp(`#{${key}}`, 'g');
    result = result.replace(regex, value !== undefined ? value : '');
  }
  return result;
}

/**
 * Get all available notification templates
 */
export function getAllTemplates() {
  const templates = {};
  for (const [event, template] of Object.entries(NOTIFICATION_TEMPLATES)) {
    templates[event] = {
      hasEmail: !!template.email,
      hasSms: !!template.sms,
      hasPush: !!template.push,
    };
  }
  return templates;
}

/**
 * Validate that an event has required templates
 */
export function validateTemplates(event, channels = ['email', 'sms', 'push']) {
  const template = NOTIFICATION_TEMPLATES[event];
  if (!template) {
    throw new Error(`No templates defined for event: ${event}`);
  }

  const missing = [];
  for (const channel of channels) {
    if (!template[channel]) {
      missing.push(channel);
    }
  }

  if (missing.length > 0) {
    throw new Error(`Missing templates for channels: ${missing.join(', ')} for event: ${event}`);
  }

  return true;
}
