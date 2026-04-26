// src/config/cookie.config.js — FINAL VERSION
import { ENV } from '#config/env.js';

export const cookieConfig = {
  accessToken: {
    httpOnly: true,
    secure: ENV.IS_PROD,
    sameSite: ENV.IS_PROD ? 'strict' : 'lax',
    maxAge: 15 * 60 * 1000, // 15 minutes
    path: '/',
    domain: process.env.COOKIE_DOMAIN || undefined,
  },

  refreshToken: {
    httpOnly: true,
    secure: ENV.IS_PROD,
    sameSite: ENV.IS_PROD ? 'strict' : 'lax',
    maxAge: 30 * 24 * 60 * 60 * 1000, // 30 days
    path: '/',
    domain: process.env.COOKIE_DOMAIN || undefined,
  },

  csrfToken: {
    httpOnly: false,
    secure: ENV.IS_PROD,
    sameSite: 'lax',
    maxAge: 24 * 60 * 60 * 1000, // 24 hours
    path: '/',
    domain: process.env.COOKIE_DOMAIN || undefined,
  },
};

export const setAuthCookies = (res, accessToken, refreshToken) => {
  res.cookie('accessToken', accessToken, cookieConfig.accessToken);
  res.cookie('refreshToken', refreshToken, cookieConfig.refreshToken);
};

export const clearAuthCookies = res => {
  const options = {
    path: '/',
    ...(process.env.COOKIE_DOMAIN && { domain: process.env.COOKIE_DOMAIN }),
  };

  res.clearCookie('accessToken', options);
  res.clearCookie('refreshToken', options);
};

export const setCsrfCookie = (res, csrfToken) => {
  res.cookie('csrfToken', csrfToken, cookieConfig.csrfToken);
};

export const clearCsrfCookie = res => {
  const options = {
    path: '/',
    ...(process.env.COOKIE_DOMAIN && { domain: process.env.COOKIE_DOMAIN }),
  };
  res.clearCookie('csrfToken', options);
};
