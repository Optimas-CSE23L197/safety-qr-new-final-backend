// =============================================================================
// tests/seed.scan.js — RESQID
//
// Self-contained seed script for scan endpoint testing.
// Creates ONE school + 9 students + 9 tokens (one per testable state/scenario)
// Prints a ready-to-use scan.http variable block at the end.
//
// USAGE:
//   node tests/seed.scan.js              # create seed data + print codes
//   node tests/seed.scan.js --clean      # delete all seeded data then exit
//   node tests/seed.scan.js --regen      # clean + re-seed (fresh codes)
//
// IDEMPOTENT: Uses a fixed school code "RQ-TEST-SCAN" as the anchor.
// Running twice without --clean skips creation and just prints codes.
//
// REQUIREMENTS:
//   - .env must be loaded (DATABASE_URL, SCAN_CODE_SECRET, ENCRYPTION_KEY)
//   - prisma client generated
//   - token.helpers.js and encryption.js must be working
//
// =============================================================================

import "../src/config/env.js"; // Load env before anything touches crypto secrets
import { prisma } from "../src/config/prisma.js";
import crypto from "crypto";
import { generateScanCode } from "../src/services/token/token.helpers.js";
import { encryptField } from "../src/utils/security/encryption.js";

// =============================================================================
// SEED ANCHORS — stable identifiers so re-runs are idempotent
// =============================================================================

const SEED_SCHOOL_CODE = "RQ-TEST-SCAN";

// Each token scenario has a stable label used to find / clean it
const SCENARIOS = [
  { label: "active_public", status: "ACTIVE", visibility: "PUBLIC" },
  { label: "active_minimal", status: "ACTIVE", visibility: "MINIMAL" },
  { label: "active_hidden", status: "ACTIVE", visibility: "HIDDEN" },
  { label: "unassigned", status: "UNASSIGNED", visibility: null },
  { label: "issued", status: "ISSUED", visibility: null },
  { label: "inactive", status: "INACTIVE", visibility: "PUBLIC" },
  { label: "revoked", status: "REVOKED", visibility: "PUBLIC" },
  { label: "expired", status: "ACTIVE", visibility: "PUBLIC" }, // ACTIVE but expires_at in past
  { label: "no_profile", status: "ACTIVE", visibility: null }, // student is_active=false
];

// =============================================================================
// MAIN
// =============================================================================

async function main() {
  const args = process.argv.slice(2);
  const clean = args.includes("--clean") || args.includes("--regen");
  const regen = args.includes("--regen");

  if (clean) {
    await cleanSeed();
    if (!regen) {
      console.log("\n✓ Seed data cleaned.\n");
      return;
    }
    console.log("✓ Cleaned. Re-seeding...\n");
  }

  await seed();
}

// =============================================================================
// CLEAN
// =============================================================================

async function cleanSeed() {
  console.log("Cleaning scan test seed data...");

  const school = await prisma.school.findUnique({
    where: { code: SEED_SCHOOL_CODE },
    select: { id: true },
  });

  if (!school) {
    console.log("  Nothing to clean — seed school not found.");
    return;
  }

  // Cascade order matters — FK constraints
  await prisma.scanLog.deleteMany({ where: { school_id: school.id } });
  await prisma.scanRateLimit.deleteMany({}); // no school FK — clean all test entries
  await prisma.registrationNonce.deleteMany({
    where: { token: { school_id: school.id } },
  });
  await prisma.emergencyContact.deleteMany({
    where: { profile: { student: { school_id: school.id } } },
  });
  await prisma.emergencyProfile.deleteMany({
    where: { student: { school_id: school.id } },
  });
  await prisma.cardVisibility.deleteMany({
    where: { student: { school_id: school.id } },
  });
  await prisma.token.deleteMany({ where: { school_id: school.id } });
  await prisma.student.deleteMany({ where: { school_id: school.id } });
  await prisma.school.delete({ where: { id: school.id } });

  console.log("  ✓ School, students, tokens, scan logs deleted.");
}

// =============================================================================
// SEED
// =============================================================================

async function seed() {
  // ── 1. School ──────────────────────────────────────────────────────────────
  let school = await prisma.school.findUnique({
    where: { code: SEED_SCHOOL_CODE },
  });

  if (school) {
    console.log(`School already exists (${school.id}) — skipping creation.`);
    console.log("Run with --regen to recreate fresh.\n");
  } else {
    school = await prisma.school.create({
      data: {
        name: "ResQid Test School",
        code: SEED_SCHOOL_CODE,
        address: "12 Test Lane, Kolkata",
        city: "Kolkata",
        state: "West Bengal",
        pincode: "700001",
        country: "IN",
        phone: "+91-9000000001",
        logo_url: "https://resqid.in/test-assets/logo.png",
        school_type: "PRIVATE",
        pricing_tier: "PRIVATE_STANDARD",
        is_active: true,
      },
    });
    console.log(`✓ School created: ${school.id}`);
  }

  // ── 2. Create scenarios ────────────────────────────────────────────────────
  const results = {};

  for (const scenario of SCENARIOS) {
    const existing = await prisma.token.findFirst({
      where: {
        school_id: school.id,
        // We tag via a batch_id comment — using notes in token isn't available.
        // Instead, look up by student first_name which we stamp with the label.
        student:
          scenario.status !== "UNASSIGNED"
            ? { first_name: `TEST_${scenario.label}` }
            : undefined,
      },
      include: { student: true },
    });

    if (existing) {
      console.log(
        `  ↩  Scenario "${scenario.label}" already exists — skipping.`,
      );
      results[scenario.label] = existing.id;
      continue;
    }

    const tokenId = await createScenario(school.id, scenario);
    results[scenario.label] = tokenId;
    console.log(`  ✓  Scenario "${scenario.label}" created`);
  }

  // ── 3. Print ready-to-use variable block ───────────────────────────────────
  printVariableBlock(results);
}

// =============================================================================
// CREATE ONE SCENARIO
// =============================================================================

async function createScenario(schoolId, scenario) {
  const { label, status, visibility } = scenario;
  const needsStudent = status !== "UNASSIGNED";

  // Token expiry
  const expiresAt =
    label === "expired"
      ? new Date(Date.now() - 1000 * 60 * 60 * 24) // yesterday
      : new Date(Date.now() + 1000 * 60 * 60 * 24 * 365); // +1 year

  let studentId = null;

  if (needsStudent) {
    // ── Student ──────────────────────────────────────────────────────────────
    const student = await prisma.student.create({
      data: {
        school_id: schoolId,
        first_name: `TEST_${label}`,
        last_name: "ResQid",
        gender: "MALE",
        class: "10",
        section: "A",
        is_active: label !== "no_profile", // no_profile has is_active=false
        setup_stage: "COMPLETE",
      },
    });

    studentId = student.id;

    // ── CardVisibility ────────────────────────────────────────────────────────
    if (visibility) {
      await prisma.cardVisibility.create({
        data: {
          student_id: studentId,
          visibility: visibility,
        },
      });
    }

    // ── EmergencyProfile + Contacts (only for students that show profile) ─────
    const needsProfile = !["no_profile", "issued", "inactive"].includes(label);
    if (needsProfile) {
      const profile = await prisma.emergencyProfile.create({
        data: {
          student_id: studentId,
          blood_group: "B_POS",
          allergies: "Penicillin, Dust mites",
          conditions: "Mild asthma",
          medications: "Salbutamol inhaler",
          doctor_name: "Dr. Priya Sharma",
          doctor_phone_encrypted: encryptField("+91-9000000099"),
          notes: "Keep inhaler accessible at all times.",
          visibility: visibility ?? "PUBLIC",
          is_visible: true,
        },
      });

      // Two contacts — one primary, one secondary
      await prisma.emergencyContact.createMany({
        data: [
          {
            profile_id: profile.id,
            name: "Ramesh Kumar",
            phone_encrypted: encryptField("+91-9000000011"),
            relationship: "Father",
            priority: 1,
            display_order: 0,
            is_active: true,
            call_enabled: true,
            whatsapp_enabled: true,
          },
          {
            profile_id: profile.id,
            name: "Sunita Kumar",
            phone_encrypted: encryptField("+91-9000000012"),
            relationship: "Mother",
            priority: 2,
            display_order: 1,
            is_active: true,
            call_enabled: true,
            whatsapp_enabled: true,
          },
        ],
      });
    }
  }

  // ── Token ─────────────────────────────────────────────────────────────────
  const rawToken = crypto.randomBytes(32).toString("hex").toUpperCase();
  const tokenHash = crypto
    .createHmac("sha256", process.env.TOKEN_HASH_SECRET)
    .update(rawToken)
    .digest("hex");

  const token = await prisma.token.create({
    data: {
      school_id: schoolId,
      student_id: studentId,
      token_hash: tokenHash,
      status: status,
      expires_at: expiresAt,
      activated_at: ["ACTIVE", "INACTIVE", "REVOKED"].includes(status)
        ? new Date()
        : null,
      assigned_at: studentId ? new Date() : null,
      revoked_at: status === "REVOKED" ? new Date() : null,
    },
  });

  return token.id;
}

// =============================================================================
// PRINT — ready-to-paste variable block for scan.http
// =============================================================================

function printVariableBlock(results) {
  console.log("\n");
  console.log("═".repeat(72));
  console.log("  COPY THIS INTO YOUR scan.http @variable BLOCK");
  console.log("═".repeat(72));
  console.log();

  const lines = [];

  for (const [label, tokenId] of Object.entries(results)) {
    let code;
    try {
      code = generateScanCode(tokenId);
    } catch (err) {
      code = `ERROR_GENERATING_CODE: ${err.message}`;
    }

    const varName = labelToVarName(label);
    lines.push({ varName, code, tokenId, label });
    console.log(`@${varName.padEnd(22)} = ${code}`);
    console.log(`# token id: ${tokenId}  (${label})`);
    console.log();
  }

  console.log("═".repeat(72));
  console.log();
  console.log("ALSO ADD:");
  console.log("@BASE_URL = http://localhost:3000");
  console.log("@SCAN_PATH = /s");
  console.log();
  console.log("FOR THE IP BLOCK TEST (D-3) — run this SQL:");
  console.log(
    `
INSERT INTO "ScanRateLimit"
  (id, identifier, identifier_type, count, window_start, last_hit,
   blocked_until, blocked_reason, block_count)
VALUES
  (gen_random_uuid(), '172.16.0.99', 'IP', 25, now(), now(),
   now() + interval '1 hour', 'Manual test block', 1)
ON CONFLICT (identifier, identifier_type) DO UPDATE
  SET blocked_until = now() + interval '1 hour';
`.trim(),
  );
  console.log();
  console.log("FOR THE NONEXISTENT UUID TEST (F-2):");
  const fakeCode = (() => {
    try {
      return generateScanCode("aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee");
    } catch {
      return "run-generateScanCode('aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee')";
    }
  })();
  console.log(`@NON_EXISTENT_CODE = ${fakeCode}`);
  console.log(
    "(Decodes to a valid UUID that doesn't exist in your Token table)",
  );
  console.log();
  console.log(
    "TO SIMULATE A TAMPERED CODE — take any real code and flip one char:",
  );
  console.log("e.g. change the 5th character to something different.");
  console.log("AES-SIV should reject it with state=INVALID.");
  console.log();
}

function labelToVarName(label) {
  const map = {
    active_public: "VALID_CODE",
    active_minimal: "MINIMAL_VIS_CODE",
    active_hidden: "HIDDEN_VIS_CODE",
    unassigned: "UNASSIGNED_CODE",
    issued: "ISSUED_CODE",
    inactive: "INACTIVE_CODE",
    revoked: "REVOKED_CODE",
    expired: "EXPIRED_CODE",
    no_profile: "NO_PROFILE_CODE",
  };
  return map[label] ?? label.toUpperCase() + "_CODE";
}

// =============================================================================
// RUN
// =============================================================================

main()
  .catch((e) => {
    console.error("\n✗ Seed failed:", e.message);
    console.error(e);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
