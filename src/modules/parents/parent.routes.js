// =============================================================================
// modules/parents/parent.route.js — RESQID (FULLY FIXED + MULTI-CHILD ENDPOINTS)
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
  // NEW IMPORTS for multi-child features
  linkCard,
  setActiveStudent,
  getChildrenList,
  unlinkChildInit,
  unlinkChildVerify,
  generateStudentPhotoUploadUrl,
  confirmStudentPhotoUpload,
  generateAvatarUploadUrl,
  confirmAvatarUpload,
} from './parent.controller.js';

import {
  validateScanHistoryQuery,
  validateUpdateProfile,
  validateUpdateVisibility,
  validateUpdateNotifications,
  validateUpdateLocationConsent,
  validateLockCard,
  validateRequestReplace,
  validateLocationHistoryQuery,
  validateAnomaliesQuery,
  validateRequestRenewal,
  validateChangePhone,
  validateSendPhoneOtp,
  validateRegisterDeviceToken,
  // NEW VALIDATIONS for multi-child features
  validateLinkCard,
  validateSetActiveStudent,
  validateUnlinkChildInit,
  validateUnlinkChildVerify,
  validateGenerateUploadUrl,
  validateConfirmUpload,
} from './parent.validation.js';

const router = Router();

// All routes require auth + PARENT_USER role
router.use(authenticate, requireParent);

// ── Core: home screen data ─────────────────────────────────────────────────────
router.get('/me', getMe);

// ── Multi-child support (NEW) ─────────────────────────────────────────────────
router.get('/me/children', getChildrenList); // GET all children (lightweight)
router.post('/me/link-card', validateLinkCard, linkCard); // Add second child by card
router.patch('/me/active-student', validateSetActiveStudent, setActiveStudent); // Switch active student

// ── Scan history (scan-history screen) ────────────────────────────────────────
router.get('/me/scans', validateScanHistoryQuery, getScanHistory);

// ── Profile update wizard (updates screen) ────────────────────────────────────
router.patch('/me/profile', validateUpdateProfile, updateProfile);

// ── Visibility (emergency + visibility screens) ────────────────────────────────
router.patch('/me/visibility', validateUpdateVisibility, updateVisibility);

// ── Notification preferences (settings screen) ────────────────────────────────
router.patch('/me/notifications', validateUpdateNotifications, updateNotifications);

// ── Location consent (settings screen) ────────────────────────────────────────
router.patch('/me/location-consent', validateUpdateLocationConsent, updateLocationConsent);

// ── Card actions (settings screen) ────────────────────────────────────────────
router.post('/me/lock-card', validateLockCard, lockCard);
router.post('/me/request-replace', validateRequestReplace, requestReplace);

// ── Location history ──────────────────────────────────────────────────────────
router.get('/me/location-history', validateLocationHistoryQuery, getLocationHistory);

// ── Anomalies list ────────────────────────────────────────────────────────────
router.get('/me/anomalies', validateAnomaliesQuery, getAnomalies);

// ── Cards list ────────────────────────────────────────────────────────────────
router.get('/me/cards', getCards);

// ── Request renewal ───────────────────────────────────────────────────────────
router.post('/me/request-renewal', validateRequestRenewal, requestRenewal);

// ── Change phone number ───────────────────────────────────────────────────────
router.post('/me/change-phone', validateChangePhone, changePhone);

// ── Send OTP for phone change ─────────────────────────────────────────────────
router.post('/me/send-phone-otp', validateSendPhoneOtp, sendPhoneChangeOtp);

// ── Account deletion (settings — danger zone) ─────────────────────────────────
router.delete('/me', deleteAccount);

// ── Push notification device token registration ───────────────────────────────
router.post('/device-token', validateRegisterDeviceToken, registerDeviceToken);

// ── Unlink child (remove child from parent account) ──────────────────────────
router.post('/me/unlink-child/init', validateUnlinkChildInit, unlinkChildInit);
router.post('/me/unlink-child/verify', validateUnlinkChildVerify, unlinkChildVerify);

// photo upload
// ── Photo Upload (Student) ──────────────────────────────────────────────────
router.post(
  '/me/students/:studentId/photo/upload-url',
  validateGenerateUploadUrl,
  generateStudentPhotoUploadUrl
);

router.post(
  '/me/students/:studentId/photo/confirm',
  validateConfirmUpload,
  confirmStudentPhotoUpload
);

// ── Photo Upload (Parent Avatar) ────────────────────────────────────────────
router.post('/me/avatar/upload-url', validateGenerateUploadUrl, generateAvatarUploadUrl);

router.post('/me/avatar/confirm', validateConfirmUpload, confirmAvatarUpload);

export default router;
