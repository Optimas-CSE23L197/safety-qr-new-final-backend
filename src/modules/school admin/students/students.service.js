// =============================================================================
// students.service.js — RESQID School Admin › Students
// Business logic + Redis caching
// =============================================================================

import { redis }    from "../../../config/redis.js";
import { logger }   from "../../../config/logger.js";
import { ApiError } from "../../../utils/Response/ApiError.js";
import * as repo    from "./students.repository.js";

// ─── Cache ────────────────────────────────────────────────────────────────────

const TTL  = { pendingCount: 20 };
const cKey = (schoolId, s) => `students:${schoolId}:${s}`;

const bustStudentCache = (schoolId) =>
  redis.del(cKey(schoolId, "pendingCount")).catch(() => {});

// ─── Student list ─────────────────────────────────────────────────────────────

export const listStudents = async (schoolId, query) => {
  const { total, items } = await repo.listStudents(schoolId, query);
  return buildPage(items, total, query);
};

export const getStudent = async (schoolId, studentId) => {
  const student = await repo.findStudentById(schoolId, studentId);
  if (!student) throw ApiError.notFound("Student not found");
  return student;
};

export const getStudentScanActivity = async (schoolId, studentId, query) => {
  // Ensure student belongs to school
  const student = await repo.findStudentById(schoolId, studentId);
  if (!student) throw ApiError.notFound("Student not found");

  const { total, items } = await repo.getStudentScanActivity(schoolId, studentId, query);
  return buildPage(items, total, query);
};

export const getStudentTokenCard = async (schoolId, studentId) => {
  const card = await repo.getStudentTokenCard(schoolId, studentId);
  if (!card) throw ApiError.notFound("Student not found");
  return card;
};

// ─── Create ───────────────────────────────────────────────────────────────────

export const createStudent = async (schoolId, data) => {
  const result = await repo.createStudent(schoolId, data);

  if (result.conflict === "admission_number") {
    throw ApiError.conflict(
      `Admission number "${data.admission_number}" is already taken in this school`,
    );
  }

  logger.info({ schoolId, studentId: result.student.id }, "students: created");
  return result.student;
};

// ─── Update ───────────────────────────────────────────────────────────────────

export const updateStudent = async (schoolId, studentId, data) => {
  const existing = await repo.findStudentById(schoolId, studentId);
  if (!existing) throw ApiError.notFound("Student not found");

  const result = await repo.updateStudent(schoolId, studentId, data);

  if (result.conflict === "admission_number") {
    throw ApiError.conflict(
      `Admission number "${data.admission_number}" is already taken in this school`,
    );
  }

  logger.info({ schoolId, studentId }, "students: updated");
  return result.student;
};

// ─── Delete ───────────────────────────────────────────────────────────────────

export const deleteStudent = async (schoolId, studentId) => {
  const existing = await repo.findStudentById(schoolId, studentId);
  if (!existing) throw ApiError.notFound("Student not found");

  // Block delete if student has an active token
  const hasActiveToken = existing.tokens?.some((t) => t.status === "ACTIVE");
  if (hasActiveToken) {
    throw ApiError.forbidden(
      "Cannot delete student with an active token — revoke the token first",
    );
  }

  await repo.softDeleteStudent(studentId);
  logger.info({ schoolId, studentId }, "students: soft-deleted");
};

// ─── Parent requests ──────────────────────────────────────────────────────────

export const listParentRequests = async (schoolId, query) => {
  const { total, items } = await repo.listParentRequests(schoolId, query);
  return buildPage(items, total, query);
};

export const approveParentRequest = async (schoolId, requestId, reviewedBy, notes) => {
  const request = await repo.findParentRequestById(schoolId, requestId);
  if (!request)                  throw ApiError.notFound("Parent request not found");
  if (request.status !== "PENDING") throw ApiError.conflict(`Request is already ${request.status.toLowerCase()}`);

  const updated = await repo.approveParentRequest(requestId, reviewedBy, notes);
  await bustStudentCache(schoolId);

  logger.info({ schoolId, requestId, reviewedBy }, "students: parent request approved");
  return updated;
};

export const rejectParentRequest = async (schoolId, requestId, reviewedBy, reason) => {
  const request = await repo.findParentRequestById(schoolId, requestId);
  if (!request)                  throw ApiError.notFound("Parent request not found");
  if (request.status !== "PENDING") throw ApiError.conflict(`Request is already ${request.status.toLowerCase()}`);

  const updated = await repo.rejectParentRequest(requestId, reviewedBy, reason);
  await bustStudentCache(schoolId);

  logger.info({ schoolId, requestId, reviewedBy }, "students: parent request rejected");
  return updated;
};

export const getPendingRequestCount = async (schoolId) => {
  const key    = cKey(schoolId, "pendingCount");
  const cached = await redis.get(key).catch(() => null);
  if (cached !== null) return { pending: parseInt(cached, 10) };

  const count = await repo.getPendingRequestCount(schoolId);
  redis.setex(key, TTL.pendingCount, String(count)).catch(() => {});
  return { pending: count };
};

// ─── Helper ───────────────────────────────────────────────────────────────────

const buildPage = (items, total, { page, limit }) => ({
  items,
  meta: {
    total,
    page,
    limit,
    totalPages: Math.ceil(total / limit),
    hasNext:    page * limit < total,
    hasPrev:    page > 1,
  },
});