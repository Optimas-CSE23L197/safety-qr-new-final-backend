// modules/notification/notification.constants.js — RESQID
export const NOTIFICATION_DELAYS = {
  WELCOME_EMAIL: 2 * 60 * 1000, // 2 min — feels personal, not instant-bot
  RENEWAL_REMINDER: 0, // immediate
  EMERGENCY: 0, // immediate, never delay
  DEVICE_ALERT: 0, // immediate security alert
  CARD_EXPIRY: 0, // immediate
};

export const APP_URLS = {
  PLAY_STORE:
    process.env.PLAY_STORE_URL ?? 'https://play.google.com/store/apps/details?id=in.getresqid.app',
  APP_STORE: process.env.APP_STORE_URL ?? 'https://apps.apple.com/app/resqid',
  DASHBOARD: process.env.DASHBOARD_URL ?? 'https://admin.getresqid.in',
  RENEW: process.env.RENEW_URL ?? 'https://getresqid.in/renew',
};

export const OTP_CONFIG = {
  DEFAULT_EXPIRY_MINUTES: 5,
  NAMESPACES: {
    LOGIN: 'login',
    REGISTER: 'register',
    PHONE_CHANGE: 'phone_change',
    EMAIL_VERIFY: 'email_verify',
    EMAIL_CHANGE: 'email_change',
  },
};

export const NOTIFICATION_CHANNELS = {
  EMAIL: 'EMAIL',
  SMS: 'SMS',
  PUSH: 'PUSH',
  SSE: 'SSE',
};
