// =============================================================================
// modules/parents/controllers/ — RESQID
// All parent controllers in one file for clarity.
// Each is a thin HTTP wrapper — all logic in parent.service.js
// =============================================================================

import * as service from "./parent.service.js";
import { requireOwnParent } from "./parent.validation.js";
import { logger } from "../../config/logger.js";

// ─── Error helper ─────────────────────────────────────────────────────────────
function handleError(res, err, context) {
  if (err.statusCode) {
    return res
      .status(err.statusCode)
      .json({ success: false, code: err.code, message: err.message });
  }
  logger.error({ ...context, err: err.message }, `${context.fn} failed`);
  return res.status(500).json({
    success: false,
    code: "INTERNAL_ERROR",
    message: "Something went wrong",
  });
}

// ─── GET /me ──────────────────────────────────────────────────────────────────
export async function getMe(req, res) {
  const parentId = requireOwnParent(req, res);
  if (!parentId) return;

  try {
    const data = await service.getParentHomeData(parentId);
    if (!data)
      return res.status(404).json({
        success: false,
        code: "NOT_FOUND",
        message: "Account not found",
      });
    return res.status(200).json({ success: true, data });
  } catch (err) {
    return handleError(res, err, { fn: "getMe", parentId });
  }
}

// ─── GET /me/scans ────────────────────────────────────────────────────────────
export async function getScanHistory(req, res) {
  const parentId = requireOwnParent(req, res);
  if (!parentId) return;

  try {
    const result = await service.getScanHistory(parentId, req.validatedQuery);
    return res.status(200).json({ success: true, data: result });
  } catch (err) {
    return handleError(res, err, { fn: "getScanHistory", parentId });
  }
}

// ─── PATCH /me/profile ────────────────────────────────────────────────────────
export async function updateProfile(req, res) {
  const parentId = requireOwnParent(req, res);
  if (!parentId) return;

  try {
    const result = await service.updateProfile(parentId, req.validatedBody);
    return res.status(200).json({ success: true, data: result });
  } catch (err) {
    return handleError(res, err, { fn: "updateProfile", parentId });
  }
}

// ─── PATCH /me/visibility ─────────────────────────────────────────────────────
export async function updateVisibility(req, res) {
  const parentId = requireOwnParent(req, res);
  if (!parentId) return;

  try {
    const result = await service.updateVisibility(parentId, req.validatedBody);
    return res.status(200).json({ success: true, data: result });
  } catch (err) {
    return handleError(res, err, { fn: "updateVisibility", parentId });
  }
}

// ─── PATCH /me/notifications ──────────────────────────────────────────────────
export async function updateNotifications(req, res) {
  const parentId = requireOwnParent(req, res);
  if (!parentId) return;

  try {
    const result = await service.updateNotifications(
      parentId,
      req.validatedBody,
    );
    return res.status(200).json({ success: true, data: result });
  } catch (err) {
    return handleError(res, err, { fn: "updateNotifications", parentId });
  }
}

// ─── PATCH /me/location-consent ───────────────────────────────────────────────
export async function updateLocationConsent(req, res) {
  const parentId = requireOwnParent(req, res);
  if (!parentId) return;

  try {
    const result = await service.updateLocationConsent(
      parentId,
      req.validatedBody,
    );
    return res.status(200).json({ success: true, data: result });
  } catch (err) {
    return handleError(res, err, { fn: "updateLocationConsent", parentId });
  }
}

// ─── POST /me/lock-card ───────────────────────────────────────────────────────
export async function lockCard(req, res) {
  const parentId = requireOwnParent(req, res);
  if (!parentId) return;

  try {
    const result = await service.lockCard(parentId, req.validatedBody);
    return res.status(200).json({ success: true, data: result });
  } catch (err) {
    return handleError(res, err, { fn: "lockCard", parentId });
  }
}

// ─── POST /me/request-replace ─────────────────────────────────────────────────
export async function requestReplace(req, res) {
  const parentId = requireOwnParent(req, res);
  if (!parentId) return;

  try {
    const result = await service.requestCardReplacement(
      parentId,
      req.validatedBody,
    );
    return res.status(201).json({ success: true, data: result });
  } catch (err) {
    return handleError(res, err, { fn: "requestReplace", parentId });
  }
}

// ─── DELETE /me ───────────────────────────────────────────────────────────────
export async function deleteAccount(req, res) {
  const parentId = requireOwnParent(req, res);
  if (!parentId) return;

  try {
    await service.deleteAccount(parentId);
    return res.status(200).json({ success: true, message: "Account deleted" });
  } catch (err) {
    return handleError(res, err, { fn: "deleteAccount", parentId });
  }
}
