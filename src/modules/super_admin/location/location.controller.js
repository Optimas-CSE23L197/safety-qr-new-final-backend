import {
  overviewSchema,
  studentsQuerySchema,
  historyParamsSchema,
  historyQuerySchema,
  zonesQuerySchema,
} from './location.validation.js';

import {
  fetchOverview,
  fetchStudents,
  fetchStudentHistory,
  fetchZones,
} from './location.service.js';

// GET /api/super/location/overview
export async function getOverview(req, res) {
  overviewSchema.parse({}); // no params — just guard
  const data = await fetchOverview();
  return res.json({ success: true, data });
}

// GET /api/super/location/students
export async function getStudents(req, res) {
  const query = studentsQuerySchema.parse(req.query);
  const result = await fetchStudents(query);
  return res.json({ success: true, ...result });
}

// GET /api/super/location/students/:studentId/history
export async function getStudentHistory(req, res) {
  const { studentId } = historyParamsSchema.parse(req.params);
  const query = historyQuerySchema.parse(req.query);
  const result = await fetchStudentHistory(studentId, query);
  return res.json({ success: true, ...result });
}

// GET /api/super/location/zones
export async function getZones(req, res) {
  const query = zonesQuerySchema.parse(req.query);
  const data = await fetchZones(query);
  return res.json({ success: true, data });
}
