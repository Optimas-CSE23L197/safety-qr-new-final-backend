import {
  getLocationOverview,
  getStudentsWithLocation,
  getStudentLocationHistory,
  getTrustedZones,
} from './location.repository.js';

export async function fetchOverview() {
  return getLocationOverview();
}

export async function fetchStudents(query) {
  return getStudentsWithLocation(query);
}

export async function fetchStudentHistory(studentId, query) {
  return getStudentLocationHistory(studentId, query);
}

export async function fetchZones(query) {
  return getTrustedZones(query);
}
