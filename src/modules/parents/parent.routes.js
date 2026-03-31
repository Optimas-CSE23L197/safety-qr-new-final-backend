// =============================================================================
// modules/parents/parent.route.js — RESQID (FIXED)
// Mounted at: /api/parents
// ALL parent app endpoints — one file, complete picture
// =============================================================================

import { Router } from 'express';
import { authenticate, requireParent } from '#middleware/auth/auth.middleware.js';

import {
  getMe,
  getScanHistory,
  updateProfile,
  updateVisibility,
  updateNotifications,
  updateLocationConsent,
  lockCard,
  requestReplace,
  deleteAccount,
  getLocationHistory,
  getAnomalies,
  getCards,
  requestRenewal,
  changePhone,
  sendPhoneChangeOtp,
  registerDeviceToken,
} from './parent.controller.js';

import {
  validateScanHistoryQuery,
  validateUpdateProfile,
  validateUpdateVisibility,
  validateUpdateNotifications,
  validateUpdateLocationConsent,
  validateLockCard,
  validateRequestReplace,
  // ✅ ADD THESE MISSING IMPORTS
  validateLocationHistoryQuery,
  validateAnomaliesQuery,
  validateRequestRenewal,
  validateChangePhone,
  validateSendPhoneOtp,
  validateRegisterDeviceToken,
} from './parent.validation.js';

const router = Router();

// All routes require auth + PARENT_USER role
router.use(authenticate, requireParent);

// ── Core: home screen data ─────────────────────────────────────────────────────
// Called once on login → response cached on device for 30 days
// Also called on pull-to-refresh
router.get('/me', getMe);

// ── Scan history (scan-history screen) ────────────────────────────────────────
// Cursor-paginated — never load all scans at once
// Client caches the last N scans, cursor-fetches more on scroll
router.get('/me/scans', validateScanHistoryQuery, getScanHistory);

// ── Profile update wizard (updates screen) ────────────────────────────────────
// Single batched PATCH — student info + emergency + contacts in one transaction
// Invalidates device cache → forces fresh /me fetch
router.patch('/me/profile', validateUpdateProfile, updateProfile);

// ── Visibility (emergency + visibility screens) ────────────────────────────────
// Updates CardVisibility: visibility level + hidden_fields[]
router.patch('/me/visibility', validateUpdateVisibility, updateVisibility);

// ── Notification preferences (settings screen) ────────────────────────────────
router.patch('/me/notifications', validateUpdateNotifications, updateNotifications);

// ── Location consent (settings screen) ────────────────────────────────────────
router.patch('/me/location-consent', validateUpdateLocationConsent, updateLocationConsent);

// ── Card actions (settings screen) ────────────────────────────────────────────
router.post('/me/lock-card', validateLockCard, lockCard);
router.post('/me/request-replace', validateRequestReplace, requestReplace);

// ── NEW: Location history ─────────────────────────────────────────────────────
router.get('/me/location-history', validateLocationHistoryQuery, getLocationHistory);

// ── NEW: Anomalies list ──────────────────────────────────────────────────────
router.get('/me/anomalies', validateAnomaliesQuery, getAnomalies);

// ── NEW: Cards list ──────────────────────────────────────────────────────────
router.get('/me/cards', getCards);

// ── NEW: Request renewal ─────────────────────────────────────────────────────
router.post('/me/request-renewal', validateRequestRenewal, requestRenewal);

// ── NEW: Change phone number ─────────────────────────────────────────────────
router.post('/me/change-phone', validateChangePhone, changePhone);

// ── NEW: Send OTP for phone change ───────────────────────────────────────────
router.post('/me/send-phone-otp', validateSendPhoneOtp, sendPhoneChangeOtp);

// ── Account deletion (settings — danger zone) ─────────────────────────────────
router.delete('/me', deleteAccount);

// parent push notification
router.post('/device-token', validateRegisterDeviceToken, registerDeviceToken);

export default router;
