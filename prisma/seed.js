// =============================================================================
// prisma/seed.js — RESQID
// Initial development seed data for HTTP testing
// Creates:
//   - Super Admin
//   - Test School + Settings + Subscription   ← fixes 400 on order endpoints
//   - School Users (admin + staff)
//   - Test Students + Emergency Profiles
//   - Tokens + Cards + QrAssets + ScanLogs
//
// Run: node prisma/seed.js
// =============================================================================

import "dotenv/config";
import bcrypt from "bcrypt";
import crypto from "crypto";
import { prisma } from "../src/config/prisma.js";

const SALT_ROUNDS = Number(process.env.SALT_ROUNDS) || 12;

function daysFromNow(n) {
  return new Date(Date.now() + n * 24 * 60 * 60 * 1000);
}

function daysAgo(n) {
  return new Date(Date.now() - n * 24 * 60 * 60 * 1000);
}

async function main() {
  // ============================================================================
  // SUPER ADMIN
  // ============================================================================

  const saEmail = "karananimesh144@gmail.com";

  const existingSa = await prisma.superAdmin.findUnique({
    where: { email: saEmail },
  });

  if (existingSa) {
    console.log("⚠️  Super admin already exists:", saEmail);
  } else {
    const password_hash = await bcrypt.hash("Karan@144#", SALT_ROUNDS);
    const admin = await prisma.superAdmin.create({
      data: {
        name: "Animesh Karan",
        email: saEmail,
        password_hash,
        is_active: true,
      },
    });
    console.log("✅ Super admin created:", admin.email);
  }

  const superAdmin = await prisma.superAdmin.findUnique({
    where: { email: saEmail },
    select: { id: true },
  });

  // ============================================================================
  // TEST SCHOOL
  // ============================================================================

  let school = await prisma.school.findUnique({
    where: { code: "TEST-001" },
  });

  if (!school) {
    school = await prisma.school.create({
      data: {
        name: "Test School",
        code: "TEST-001",
        email: "school@test.com",
        phone: "9999999999",
        city: "Kolkata",
        state: "West Bengal",
        pincode: "700001",
        country: "IN",
        school_type: "PRIVATE",
        pricing_tier: "PRIVATE_STANDARD",
        is_active: true,
      },
    });
    console.log("✅ School created:", school.id);
  } else {
    console.log("⚠️  Test school already exists:", school.id);
  }

  // ============================================================================
  // SCHOOL SETTINGS
  // ============================================================================

  const existingSettings = await prisma.schoolSettings.findUnique({
    where: { school_id: school.id },
  });

  if (!existingSettings) {
    await prisma.schoolSettings.create({
      data: {
        school_id: school.id,
        token_validity_months: 12,
        max_tokens_per_student: 1,
      },
    });
    console.log("✅ School settings created");
  } else {
    console.log("⚠️  School settings already exists");
  }

  // ============================================================================
  // SUBSCRIPTION
  // Required for order pipeline — step2.confirm.js checks for ACTIVE subscription
  // Without this: every card request / order confirm returns 400
  // ============================================================================

  const existingSub = await prisma.subscription.findFirst({
    where: { school_id: school.id },
  });

  if (!existingSub) {
    await prisma.subscription.create({
      data: {
        school_id: school.id,
        plan: "FREE_PILOT",
        status: "ACTIVE",
        provider: "manual",
        school_type: "PRIVATE",
        pricing_tier: "PRIVATE_STANDARD",
        student_count: 500,
        unit_price: 0,
        renewal_price: 0,
        total_amount: 0,
        tax_amount: 0,
        grand_total: 0,
        advance_paid: 0,
        balance_due: 0,
        current_period_start: new Date(),
        current_period_end: daysFromNow(365),
      },
    });
    console.log("✅ Subscription created — FREE_PILOT ACTIVE");
  } else {
    console.log("⚠️  Subscription already exists");
  }

  // ============================================================================
  // SCHOOL USERS
  // ============================================================================

  const schoolAdminEmail = "schooladmin@test.com";
  const existingAdmin = await prisma.schoolUser.findUnique({
    where: { email: schoolAdminEmail },
  });

  if (!existingAdmin) {
    const password_hash = await bcrypt.hash("Admin@123#", SALT_ROUNDS);
    const schoolAdmin = await prisma.schoolUser.create({
      data: {
        school_id: school.id,
        email: schoolAdminEmail,
        password_hash,
        name: "School Admin",
        role: "ADMIN",
        is_active: true,
      },
    });
    console.log("✅ School admin created:", schoolAdmin.id);
  } else {
    console.log("⚠️  School admin already exists");
  }

  const staffEmail = "schoolstaff@test.com";
  const existingStaff = await prisma.schoolUser.findUnique({
    where: { email: staffEmail },
  });

  if (!existingStaff) {
    const password_hash = await bcrypt.hash("Staff@123#", SALT_ROUNDS);
    const schoolStaff = await prisma.schoolUser.create({
      data: {
        school_id: school.id,
        email: staffEmail,
        password_hash,
        name: "School Staff",
        role: "STAFF",
        is_active: true,
      },
    });
    console.log("✅ School staff created:", schoolStaff.id);
  } else {
    console.log("⚠️  School staff already exists");
  }

  // ============================================================================
  // STUDENTS
  // ============================================================================

  const student1 = await prisma.student.create({
    data: {
      school_id: school.id,
      first_name: "Aryan",
      last_name: "Sharma",
      class: "8",
      section: "B",
      roll_number: "801",
      setup_stage: "COMPLETE",
      is_active: true,
    },
  });
  console.log("✅ Student created: Aryan Sharma —", student1.id);

  const student2 = await prisma.student.create({
    data: {
      school_id: school.id,
      first_name: "Priya",
      last_name: "Verma",
      class: "9",
      section: "A",
      roll_number: "901",
      setup_stage: "COMPLETE",
      is_active: true,
    },
  });
  console.log("✅ Student created: Priya Verma —", student2.id);

  // ============================================================================
  // EMERGENCY PROFILES
  // ============================================================================

  await prisma.emergencyProfile.create({
    data: {
      student_id: student1.id,
      blood_group: "B_POS",
      allergies: "Penicillin",
      conditions: "Mild asthma",
      medications: "Salbutamol inhaler",
      doctor_name: "Dr. Suresh Kumar",
      visibility: "PUBLIC",
      is_visible: true,
    },
  });

  await prisma.emergencyProfile.create({
    data: {
      student_id: student2.id,
      blood_group: "O_POS",
      visibility: "PUBLIC",
      is_visible: true,
    },
  });
  console.log("✅ Emergency profiles created");

  // ============================================================================
  // TOKENS
  // ============================================================================

  const token1 = await prisma.token.create({
    data: {
      school_id: school.id,
      student_id: student1.id,
      token_hash: crypto.randomBytes(32).toString("hex"),
      status: "ACTIVE",
      activated_at: daysAgo(90),
      assigned_at: daysAgo(90),
      expires_at: daysFromNow(275),
    },
  });

  const token2 = await prisma.token.create({
    data: {
      school_id: school.id,
      student_id: student2.id,
      token_hash: crypto.randomBytes(32).toString("hex"),
      status: "ISSUED",
      assigned_at: daysAgo(10),
      expires_at: daysFromNow(355),
    },
  });

  const token3 = await prisma.token.create({
    data: {
      school_id: school.id,
      student_id: null,
      token_hash: crypto.randomBytes(32).toString("hex"),
      status: "UNASSIGNED",
      expires_at: daysFromNow(365),
    },
  });

  const token4 = await prisma.token.create({
    data: {
      school_id: school.id,
      student_id: null,
      token_hash: crypto.randomBytes(32).toString("hex"),
      status: "REVOKED",
      expires_at: daysFromNow(300),
      revoked_at: daysAgo(5),
    },
  });

  const token5 = await prisma.token.create({
    data: {
      school_id: school.id,
      student_id: null,
      token_hash: crypto.randomBytes(32).toString("hex"),
      status: "EXPIRED",
      expires_at: daysAgo(30),
    },
  });

  console.log(
    "✅ Tokens created — ACTIVE / ISSUED / UNASSIGNED / REVOKED / EXPIRED",
  );

  // ============================================================================
  // CARDS — new format RQ-{4digit serial}-{8hex} = 16 chars always
  // ============================================================================

  const serial = String(school.serial_number ?? 1).padStart(4, "0");
  const cardNum1 = `RQ-${serial}-${crypto.randomBytes(4).toString("hex").toUpperCase()}`;
  const cardNum2 = `RQ-${serial}-${crypto.randomBytes(4).toString("hex").toUpperCase()}`;

  await prisma.card.create({
    data: {
      school_id: school.id,
      student_id: student1.id,
      token_id: token1.id,
      card_number: cardNum1,
      print_status: "PRINTED",
      printed_at: daysAgo(90),
    },
  });

  await prisma.card.create({
    data: {
      school_id: school.id,
      student_id: student2.id,
      token_id: token2.id,
      card_number: cardNum2,
      print_status: "PRINTED",
      printed_at: daysAgo(10),
    },
  });
  console.log("✅ Cards created —", cardNum1, "/", cardNum2);

  // ============================================================================
  // QR ASSETS
  // ============================================================================

  await prisma.qrAsset.create({
    data: {
      token_id: token1.id,
      school_id: school.id,
      storage_key: `qr/${school.id}/${token1.id}.png`,
      public_url: `https://cdn.resqid.in/qr/${school.id}/${token1.id}.png`,
      format: "PNG",
      qr_type: "BLANK",
      generated_by: superAdmin?.id ?? "system",
      is_active: true,
      generated_at: daysAgo(90),
    },
  });

  await prisma.qrAsset.create({
    data: {
      token_id: token2.id,
      school_id: school.id,
      storage_key: `qr/${school.id}/${token2.id}.png`,
      public_url: `https://cdn.resqid.in/qr/${school.id}/${token2.id}.png`,
      format: "PNG",
      qr_type: "BLANK",
      generated_by: superAdmin?.id ?? "system",
      is_active: true,
      generated_at: daysAgo(10),
    },
  });
  console.log("✅ QrAssets created");

  // ============================================================================
  // CARD VISIBILITY
  // ============================================================================

  await prisma.cardVisibility.createMany({
    data: [
      { student_id: student1.id, visibility: "PUBLIC", hidden_fields: [] },
      { student_id: student2.id, visibility: "PUBLIC", hidden_fields: [] },
    ],
  });
  console.log("✅ CardVisibility created — PUBLIC for both");

  // ============================================================================
  // SCAN LOGS — for scan history / stats testing
  // ============================================================================

  await prisma.scanLog.createMany({
    data: [
      {
        token_id: token1.id,
        school_id: school.id,
        result: "SUCCESS",
        ip_city: "Kolkata",
        ip_region: "West Bengal",
        ip_country: "IN",
        scan_purpose: "EMERGENCY",
        created_at: daysAgo(1),
      },
      {
        token_id: token1.id,
        school_id: school.id,
        result: "SUCCESS",
        ip_city: "Delhi",
        ip_region: "Delhi",
        ip_country: "IN",
        scan_purpose: null,
        created_at: daysAgo(5),
      },
      {
        token_id: token1.id,
        school_id: school.id,
        result: "RATE_LIMITED",
        ip_city: "Kolkata",
        ip_region: "West Bengal",
        ip_country: "IN",
        scan_purpose: null,
        created_at: daysAgo(7),
      },
    ],
  });
  console.log("✅ ScanLogs created — 3 entries for Aryan");

  // ============================================================================
  // SUMMARY — copy-paste these into your .http files
  // ============================================================================

  console.log("\n═══════════════════════════════════════════════════════════");
  console.log("                    SEED DATA SUMMARY");
  console.log("═══════════════════════════════════════════════════════════");

  console.log("\n── Paste into .http @variable blocks ───────────────────────");
  console.log(`@schoolId  = ${school.id}`);
  console.log(`@student1  = ${student1.id}`);
  console.log(`@student2  = ${student2.id}`);
  console.log(`@token1    = ${token1.id}  ← ACTIVE`);
  console.log(`@token2    = ${token2.id}  ← ISSUED`);
  console.log(`@token3    = ${token3.id}  ← UNASSIGNED`);
  console.log(`@token4    = ${token4.id}  ← REVOKED`);
  console.log(`@token5    = ${token5.id}  ← EXPIRED`);
  console.log(`@card1     = ${cardNum1}`);
  console.log(`@card2     = ${cardNum2}`);

  console.log("\n── Super Admin ─────────────────────────────────────────────");
  console.log("   POST /api/auth/super-admin");
  console.log("   email    : karananimesh144@gmail.com");
  console.log("   password : Karan@144#");

  console.log("\n── School Admin ────────────────────────────────────────────");
  console.log("   POST /api/auth/school");
  console.log("   email    : schooladmin@test.com");
  console.log("   password : Admin@123#");

  console.log("\n── School Staff ────────────────────────────────────────────");
  console.log("   POST /api/auth/school");
  console.log("   email    : schoolstaff@test.com");
  console.log("   password : Staff@123#");

  console.log("\n── Subscription ────────────────────────────────────────────");
  console.log("   plan     : FREE_PILOT");
  console.log("   status   : ACTIVE");
  console.log("   valid    : 1 year from today");

  console.log(
    "\n═══════════════════════════════════════════════════════════\n",
  );
}

main()
  .catch((e) => {
    console.error("❌ Seed failed:", e);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
