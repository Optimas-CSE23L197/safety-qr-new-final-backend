// =============================================================================
// students.controller.js — RESQID School Admin › Students
// Thin HTTP layer — extract from req, call service, respond
// =============================================================================

import { ApiResponse }  from "../../../utils/Response/ApiResponse.js";
import { asyncHandler } from "../../../utils/Response/asyncHandler.js";
import * as svc         from "./students.service.js";

// ─── Students ─────────────────────────────────────────────────────────────────

export const listStudents = asyncHandler(async (req, res) => {
  const result = await svc.listStudents(req.user.school_id, req.query);
  return ApiResponse.paginated(result.items, result.meta).send(res);
});

export const getStudent = asyncHandler(async (req, res) => {
  const data = await svc.getStudent(req.user.school_id, req.params.id);
  return ApiResponse.ok(data, "Student detail").send(res);
});

export const getStudentScanActivity = asyncHandler(async (req, res) => {
  const result = await svc.getStudentScanActivity(req.user.school_id, req.params.id, req.query);
  return ApiResponse.paginated(result.items, result.meta).send(res);
});

export const getStudentTokenCard = asyncHandler(async (req, res) => {
  const data = await svc.getStudentTokenCard(req.user.school_id, req.params.id);
  return ApiResponse.ok(data, "Token card data").send(res);
});

export const createStudent = asyncHandler(async (req, res) => {
  const data = await svc.createStudent(req.user.school_id, req.body);
  return ApiResponse.created(data, "Student enrolled successfully").send(res);
});

export const updateStudent = asyncHandler(async (req, res) => {
  const data = await svc.updateStudent(req.user.school_id, req.params.id, req.body);
  return ApiResponse.ok(data, "Student updated").send(res);
});

export const deleteStudent = asyncHandler(async (req, res) => {
  await svc.deleteStudent(req.user.school_id, req.params.id);
  return ApiResponse.noContent().send(res);
});

// ─── Parent requests ──────────────────────────────────────────────────────────

export const listParentRequests = asyncHandler(async (req, res) => {
  const result = await svc.listParentRequests(req.user.school_id, req.query);
  return ApiResponse.paginated(result.items, result.meta).send(res);
});

export const approveParentRequest = asyncHandler(async (req, res) => {
  const data = await svc.approveParentRequest(
    req.user.school_id,
    req.params.id,
    req.userId,
    req.body?.notes,
  );
  return ApiResponse.ok(data, "Parent request approved").send(res);
});

export const rejectParentRequest = asyncHandler(async (req, res) => {
  const data = await svc.rejectParentRequest(
    req.user.school_id,
    req.params.id,
    req.userId,
    req.body.reason,
  );
  return ApiResponse.ok(data, "Parent request rejected").send(res);
});

export const getPendingRequestCount = asyncHandler(async (req, res) => {
  const data = await svc.getPendingRequestCount(req.user.school_id);
  return ApiResponse.ok(data).send(res);
});