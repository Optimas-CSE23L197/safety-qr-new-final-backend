// =============================================================================
// modules/parents/parent.route.js — RESQID (FIXED IMPORTS)
// =============================================================================

import { authenticate, requireParent } from '#middleware/auth/auth.middleware.js';
import { Router } from 'express';

import {
  changePhone,
  confirmAvatarUpload,
  confirmStudentPhotoUpload,
  deleteAccount,
  generateAvatarUploadUrl,
  generateStudentPhotoUploadUrl,
  getAnomalies,
  getCards,
  getChildrenList,
  getLocationHistory,
  getMe,
  getScanHistory,
  linkCard,
  lockCard,
  registerDeviceToken,
  requestRenewal,
  requestReplace,
  sendPhoneChangeOtp,
  setActiveStudent,
  unlinkChildInit,
  unlinkChildVerify,
  updateLocationConsent,
  updateNotifications,
  updateParentProfile,
  updateProfile,
  // ✅ ADD THESE IMPORTS
  updateStudentBasic,
  updateVisibility,
} from './parent.controller.js';

import {
  validateAnomaliesQuery,
  validateChangePhone,
  validateConfirmUpload,
  validateGenerateUploadUrl,
  validateLinkCard,
  validateLocationHistoryQuery,
  validateLockCard,
  validateParentProfile,
  validateRegisterDeviceToken,
  validateRequestRenewal,
  validateRequestReplace,
  validateScanHistoryQuery,
  validateSendPhoneOtp,
  validateSetActiveStudent,
  // ✅ ADD THESE IMPORTS
  validateStudentBasic,
  validateUnlinkChildInit,
  validateUnlinkChildVerify,
  validateUpdateLocationConsent,
  validateUpdateNotifications,
  validateUpdateProfile,
  validateUpdateVisibility,
} from './parent.validation.js';

const router = Router();

// All routes require auth + PARENT_USER role
router.use(authenticate, requireParent);

// ── Core: home screen data ─────────────────────────────────────────────────────
router.get('/me', getMe);

// ── Multi-child support ───────────────────────────────────────────────────────
router.get('/me/children', getChildrenList);
router.post('/me/link-card', validateLinkCard, linkCard);
router.patch('/me/active-student', validateSetActiveStudent, setActiveStudent);

// ── Student basic info (NEW) ──────────────────────────────────────────────────
router.patch('/me/students/:studentId/basic', validateStudentBasic, updateStudentBasic);

// ── Parent profile (NEW) ──────────────────────────────────────────────────────
router.patch('/me/profile', validateParentProfile, updateParentProfile);

// ── Scan history ──────────────────────────────────────────────────────────────
router.get('/me/scans', validateScanHistoryQuery, getScanHistory);

// ── Profile update wizard (emergency + contacts) ──────────────────────────────
router.patch('/me/profile/emergency', validateUpdateProfile, updateProfile);

// ── Visibility ────────────────────────────────────────────────────────────────
router.patch('/me/visibility', validateUpdateVisibility, updateVisibility);

// ── Notification preferences ──────────────────────────────────────────────────
router.patch('/me/notifications', validateUpdateNotifications, updateNotifications);

// ── Location consent ──────────────────────────────────────────────────────────
router.patch('/me/location-consent', validateUpdateLocationConsent, updateLocationConsent);

// ── Card actions ──────────────────────────────────────────────────────────────
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
router.post('/me/send-phone-otp', validateSendPhoneOtp, sendPhoneChangeOtp);

// ── Account deletion ──────────────────────────────────────────────────────────
router.delete('/me', deleteAccount);

// ── Push notification device token ────────────────────────────────────────────
router.post('/device-token', validateRegisterDeviceToken, registerDeviceToken);

// ── Unlink child ──────────────────────────────────────────────────────────────
router.post('/me/unlink-child/init', validateUnlinkChildInit, unlinkChildInit);
router.post('/me/unlink-child/verify', validateUnlinkChildVerify, unlinkChildVerify);

// ── Photo Upload (Student) ────────────────────────────────────────────────────
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

// ── Photo Upload (Parent Avatar) ──────────────────────────────────────────────
router.post('/me/avatar/upload-url', validateGenerateUploadUrl, generateAvatarUploadUrl);
router.post('/me/avatar/confirm', validateConfirmUpload, confirmAvatarUpload);

export default router;
