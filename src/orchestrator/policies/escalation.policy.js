// =============================================================================
// orchestrator/policies/escalation.policy.js — RESQID
// Defines when to escalate, who to notify, and how to call the Slack webhook.
// =============================================================================

import { logger } from '#config/logger.js';

const SLACK_WEBHOOK_URL = process.env.SLACK_ALERTS_WEBHOOK;

/**
 * Fire a Slack webhook with a structured message.
 * Never throws — if Slack is down, log and continue.
 *
 * @param {object} params
 * @param {string} params.title
 * @param {string} params.level — 'critical' | 'warning' | 'info'
 * @param {object} params.fields — key/value pairs shown in the Slack message
 */
export const notifySlack = async ({ title, level = 'warning', fields = {} }) => {
  if (!SLACK_WEBHOOK_URL) {
    logger.warn({ title }, '[escalation] SLACK_ALERTS_WEBHOOK not set — skipping Slack alert');
    return;
  }

  const color = level === 'critical' ? '#FF0000' : level === 'warning' ? '#FFA500' : '#36a64f';
  const emoji = level === 'critical' ? '🚨' : level === 'warning' ? '⚠️' : 'ℹ️';

  const payload = {
    attachments: [
      {
        color,
        title: `${emoji} ${title}`,
        fields: Object.entries(fields).map(([key, value]) => ({
          title: key,
          value: String(value),
          short: true,
        })),
        footer: 'RESQID Orchestrator',
        ts: Math.floor(Date.now() / 1000),
      },
    ],
  };

  try {
    const res = await fetch(SLACK_WEBHOOK_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
      signal: AbortSignal.timeout(5000),
    });

    if (!res.ok) {
      logger.warn({ status: res.status, title }, '[escalation] Slack webhook returned non-2xx');
    } else {
      logger.info({ title, level }, '[escalation] Slack alert sent');
    }
  } catch (err) {
    logger.error({ err: err.message, title }, '[escalation] Failed to send Slack alert');
  }
};

/**
 * Escalation rules — called by dlq.handler.js and emergency worker.
 */
export const ESCALATION_RULES = Object.freeze({
  // Emergency queue exhaustion → immediate Slack (critical)
  EMERGENCY_EXHAUSTED: {
    shouldSlack: true,
    immediate: true,
    level: 'critical',
    title: 'Emergency alert pipeline failed — all retries exhausted',
  },

  // Background / notification queue exhaustion → batched Slack (warning)
  NORMAL_EXHAUSTED: {
    shouldSlack: true,
    immediate: false, // batched hourly in dlq.handler.js
    level: 'warning',
    title: 'Job exhausted all retries — moved to DLQ',
  },

  // Stalled pipeline detected
  PIPELINE_STALLED: {
    shouldSlack: true,
    immediate: true,
    level: 'warning',
    title: 'Order pipeline stalled — worker may be down',
  },
});
