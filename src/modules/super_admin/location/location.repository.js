import { prisma } from '#config/prisma.js';

// ─── helpers ──────────────────────────────────────────────────────────────────

/**
 * For each zone, check whether a lat/lng point falls within radius_m.
 * Pure JS — no PostGIS needed.
 */
function haversineKm(lat1, lon1, lat2, lon2) {
  const R = 6371;
  const dLat = ((lat2 - lat1) * Math.PI) / 180;
  const dLon = ((lon2 - lon1) * Math.PI) / 180;
  const a =
    Math.sin(dLat / 2) ** 2 +
    Math.cos((lat1 * Math.PI) / 180) * Math.cos((lat2 * Math.PI) / 180) * Math.sin(dLon / 2) ** 2;
  return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
}

function isPointInZone(lat, lng, zone) {
  if (!zone.latitude || !zone.longitude) return false;
  const distKm = haversineKm(lat, lng, zone.latitude, zone.longitude);
  return distKm * 1000 <= zone.radius_m;
}

// ─── overview ─────────────────────────────────────────────────────────────────

/**
 * Returns everything the KPI row + school access bar needs.
 * Single query fan-out — no N+1.
 */
export async function getLocationOverview() {
  // 1. School access flags (only id, name, code, allow_location)
  const schools = await prisma.school.findMany({
    where: { is_active: true },
    select: {
      id: true,
      name: true,
      code: true,
      settings: { select: { allow_location: true } },
    },
    orderBy: { name: 'asc' },
  });

  const schoolRows = schools.map(s => ({
    id: s.id,
    name: s.name,
    code: s.code,
    allow_location: s.settings?.allow_location ?? false,
  }));

  const enabledSchoolIds = schoolRows.filter(s => s.allow_location).map(s => s.id);

  // 2. Active trusted zones count
  const activeZones = await prisma.trustedScanZone.count({
    where: { is_active: true },
  });

  // 3. Consent breakdown — only for schools that allow location
  const [consented, notConsented] = await Promise.all([
    prisma.locationConsent.count({
      where: {
        enabled: true,
        student: { school_id: { in: enabledSchoolIds }, is_active: true },
      },
    }),
    prisma.locationConsent.count({
      where: {
        enabled: false,
        student: { school_id: { in: enabledSchoolIds }, is_active: true },
      },
    }),
  ]);

  // 4. In-zone count — requires fetching last events + zone data together.
  //    We keep this lightweight: fetch last event per consented student +
  //    active zones, then compute in JS.
  const zones = await prisma.trustedScanZone.findMany({
    where: { is_active: true },
    select: { school_id: true, latitude: true, longitude: true, radius_m: true },
  });

  // Last event per student (subquery pattern via Prisma groupBy is not ideal;
  // use raw for efficiency on large datasets — kept as Prisma for now)
  const lastEvents = await prisma.locationEvent.findMany({
    where: {
      school_id: { in: enabledSchoolIds },
      student: { locationConsent: { enabled: true }, is_active: true },
    },
    select: { student_id: true, school_id: true, latitude: true, longitude: true },
    orderBy: { created_at: 'desc' },
    // Dedup in JS — Prisma doesn't support DISTINCT ON
  });

  // keep only the most recent event per student
  const seen = new Set();
  const deduped = [];
  for (const e of lastEvents) {
    if (!seen.has(e.student_id)) {
      seen.add(e.student_id);
      deduped.push(e);
    }
  }

  let inZone = 0;
  let outsideZone = 0;
  for (const e of deduped) {
    const schoolZones = zones.filter(z => z.school_id === e.school_id);
    const inside = schoolZones.some(z => isPointInZone(e.latitude, e.longitude, z));
    if (inside) inZone++;
    else outsideZone++;
  }

  return {
    schools: schoolRows,
    kpi: {
      tracked: consented,
      in_zone: inZone,
      outside_zone: outsideZone,
      no_consent: notConsented,
      active_zones: activeZones,
      loc_enabled: enabledSchoolIds.length,
      total_schools: schoolRows.length,
    },
  };
}

// ─── students list ─────────────────────────────────────────────────────────────

export async function getStudentsWithLocation({
  school_id,
  consent,
  zone,
  source,
  search,
  page,
  limit,
}) {
  // Step 1: build student WHERE
  const studentWhere = {
    is_active: true,
    ...(school_id && { school_id }),
    // Only students in schools with allow_location = true
    school: { settings: { allow_location: true } },
    ...(consent === 'GRANTED' && { locationConsent: { enabled: true } }),
    ...(consent === 'REVOKED' && {
      OR: [{ locationConsent: { enabled: false } }, { locationConsent: null }],
    }),
  };

  if (search) {
    studentWhere.OR = [
      { first_name: { contains: search, mode: 'insensitive' } },
      { last_name: { contains: search, mode: 'insensitive' } },
      { id: { contains: search, mode: 'insensitive' } },
      { school: { name: { contains: search, mode: 'insensitive' } } },
    ];
  }

  // Step 2: fetch students with consent + school
  const students = await prisma.student.findMany({
    where: studentWhere,
    select: {
      id: true,
      first_name: true,
      last_name: true,
      class: true,
      section: true,
      school_id: true,
      school: {
        select: { id: true, name: true, code: true, city: true },
      },
      locationConsent: {
        select: { enabled: true, consented_by: true, updated_at: true },
      },
    },
    orderBy: { first_name: 'asc' },
  });

  if (students.length === 0) return { data: [], total: 0, page, limit };

  const studentIds = students.map(s => s.id);
  const schoolIds = [...new Set(students.map(s => s.school_id))];

  // Step 3: last event per student (one query, dedup in JS)
  const [allLastEvents, activeZones, eventCounts] = await Promise.all([
    prisma.locationEvent.findMany({
      where: { student_id: { in: studentIds } },
      select: {
        id: true,
        student_id: true,
        latitude: true,
        longitude: true,
        accuracy: true,
        source: true,
        created_at: true,
        school_id: true,
      },
      orderBy: { created_at: 'desc' },
    }),
    prisma.trustedScanZone.findMany({
      where: { school_id: { in: schoolIds }, is_active: true },
      select: { school_id: true, latitude: true, longitude: true, radius_m: true },
    }),
    // event count per student
    prisma.locationEvent.groupBy({
      by: ['student_id'],
      where: { student_id: { in: studentIds } },
      _count: { id: true },
    }),
  ]);

  // Dedup last events
  const lastEventMap = new Map();
  for (const e of allLastEvents) {
    if (!lastEventMap.has(e.student_id)) lastEventMap.set(e.student_id, e);
  }

  const eventCountMap = new Map(eventCounts.map(r => [r.student_id, r._count.id]));

  // Step 4: assemble + compute in_zone
  let rows = students.map(s => {
    const le = lastEventMap.get(s.id) ?? null;
    const schoolZones = activeZones.filter(z => z.school_id === s.school_id);
    const in_zone = le ? schoolZones.some(z => isPointInZone(le.latitude, le.longitude, z)) : false;

    return {
      id: s.id,
      first_name: s.first_name,
      last_name: s.last_name,
      class: s.class,
      section: s.section,
      school_id: s.school_id,
      school: s.school,
      consent: s.locationConsent ?? { enabled: false, consented_by: null, updated_at: null },
      last_event: le
        ? {
            id: le.id,
            latitude: le.latitude,
            longitude: le.longitude,
            accuracy: le.accuracy,
            source: le.source,
            created_at: le.created_at,
          }
        : null,
      in_zone,
      event_count: eventCountMap.get(s.id) ?? 0,
    };
  });

  // Step 5: post-filter zone & source (can't push into Prisma WHERE cleanly)
  if (zone === 'IN_ZONE') {
    rows = rows.filter(r => r.consent.enabled && r.in_zone && r.last_event);
  } else if (zone === 'OUTSIDE') {
    rows = rows.filter(r => r.consent.enabled && !r.in_zone && r.last_event);
  }

  if (source !== 'ALL') {
    rows = rows.filter(r => r.last_event?.source === source);
  }

  // Step 6: paginate
  const total = rows.length;
  const data = rows.slice((page - 1) * limit, page * limit);

  return { data, total, page, limit };
}

// ─── student history ───────────────────────────────────────────────────────────

export async function getStudentLocationHistory(studentId, { page, limit }) {
  const [events, total] = await Promise.all([
    prisma.locationEvent.findMany({
      where: { student_id: studentId },
      select: {
        id: true,
        latitude: true,
        longitude: true,
        accuracy: true,
        source: true,
        created_at: true,
      },
      orderBy: { created_at: 'desc' },
      skip: (page - 1) * limit,
      take: limit,
    }),
    prisma.locationEvent.count({ where: { student_id: studentId } }),
  ]);

  // Enrich each event with in_zone flag
  const zones = await prisma.trustedScanZone.findMany({
    where: {
      school_id:
        (
          await prisma.student.findUnique({
            where: { id: studentId },
            select: { school_id: true },
          })
        )?.school_id ?? '',
      is_active: true,
    },
    select: { latitude: true, longitude: true, radius_m: true },
  });

  const enriched = events.map(e => ({
    ...e,
    in_zone: zones.some(z => isPointInZone(e.latitude, e.longitude, z)),
  }));

  return { data: enriched, total, page, limit };
}

// ─── trusted zones ─────────────────────────────────────────────────────────────

export async function getTrustedZones({ school_id }) {
  return prisma.trustedScanZone.findMany({
    where: {
      ...(school_id && { school_id }),
    },
    select: {
      id: true,
      school_id: true,
      label: true,
      latitude: true,
      longitude: true,
      radius_m: true,
      ip_range: true,
      is_active: true,
      created_at: true,
      school: { select: { id: true, name: true, code: true } },
    },
    orderBy: [{ school_id: 'asc' }, { label: 'asc' }],
  });
}
