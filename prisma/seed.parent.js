// =============================================================================
// seed.parent.js — RESQID
// Complete parent app test data
// Run: node prisma/seed.parent.js
//
// Uses same PrismaClient setup as src/config/prisma.js (PrismaPg adapter)
// =============================================================================

import "dotenv/config";
import bcrypt from "bcrypt";
import crypto from "crypto";
import { PrismaClient } from "../src/generated/client.js";
import { PrismaPg } from "@prisma/adapter-pg";

// ─── Client (mirrors src/config/prisma.js exactly) ───────────────────────────
const adapter = new PrismaPg({ connectionString: process.env.DATABASE_URL });
const prisma = new PrismaClient({ adapter, errorFormat: "pretty" });

const SALT_ROUNDS = Number(process.env.SALT_ROUNDS) || 12;

// ─── Helpers ──────────────────────────────────────────────────────────────────

function tokenHash() {
  return crypto.randomBytes(32).toString("hex");
}

function daysFromNow(n) {
  return new Date(Date.now() + n * 24 * 60 * 60 * 1000);
}

function daysAgo(n) {
  return new Date(Date.now() - n * 24 * 60 * 60 * 1000);
}

// Minimal encryption that matches your encryptField format
// Replace with your actual import if you want real encryption in seed
function encryptField(value) {
  const key = crypto
    .createHash("sha256")
    .update(process.env.ENCRYPTION_KEY ?? "seed-dev-key-32chars-placeholder!")
    .digest();
  const iv = crypto.randomBytes(16);
  const cipher = crypto.createCipheriv("aes-256-cbc", key, iv);
  const enc = Buffer.concat([cipher.update(value, "utf8"), cipher.final()]);
  return `${iv.toString("hex")}:${enc.toString("hex")}`;
}

function phoneIndex(phone) {
  // Mirrors your hashForLookup() — HMAC-SHA256 of phone
  return crypto
    .createHmac(
      "sha256",
      process.env.PHONE_INDEX_SECRET ?? "seed-phone-index-secret",
    )
    .update(phone)
    .digest("hex");
}

// ─── Main ─────────────────────────────────────────────────────────────────────

async function main() {
  console.log("🌱 Seeding parent app test data...\n");

  // ── Re-use existing school from seed.js ───────────────────────────────────
  const school = await prisma.school.findUnique({
    where: { code: "TEST-001" },
  });

  if (!school) {
    console.error(
      "❌ School TEST-001 not found. Run the main seed first:\n   node prisma/seed.js",
    );
    process.exit(1);
  }
  console.log("✅ School found:", school.id, "—", school.name);

  // ── Subscription ──────────────────────────────────────────────────────────
  const existingSub = await prisma.subscription.findFirst({
    where: { school_id: school.id },
  });

  let subscription = existingSub;
  if (!existingSub) {
    subscription = await prisma.subscription.create({
      data: {
        school_id: school.id,
        plan: "PRIVATE_STANDARD",
        status: "ACTIVE",
        provider: "manual",
        school_type: "PRIVATE",
        pricing_tier: "PRIVATE_STANDARD",
        student_count: 120,
        unit_price: 19900,
        renewal_price: 10000,
        total_amount: 2388000,
        tax_amount: 429840,
        grand_total: 2817840,
        advance_paid: 1408920,
        balance_due: 1408920,
        current_period_start: daysAgo(60),
        current_period_end: daysFromNow(305),
      },
    });
    console.log("✅ Subscription created — ACTIVE");
  } else {
    console.log("⚠️  Subscription already exists");
  }

  // ── Students ──────────────────────────────────────────────────────────────
  // Student 1 — Aarav Sharma (ACTIVE token, full profile)
  const aarav = await prisma.student.create({
    data: {
      school_id: school.id,
      profile_type: "STUDENT",
      setup_stage: "COMPLETE",
      first_name: "Aarav",
      last_name: "Sharma",
      gender: "MALE",
      class: "Class 9",
      section: "A",
      roll_number: "901",
      admission_number: "DPS/2019/0042",
      is_active: true,
    },
  });
  console.log("✅ Student created: Aarav Sharma —", aarav.id);

  // Student 2 — Priya Sharma (ISSUED token, needs activation)
  const priya = await prisma.student.create({
    data: {
      school_id: school.id,
      profile_type: "STUDENT",
      setup_stage: "COMPLETE",
      first_name: "Priya",
      last_name: "Sharma",
      gender: "FEMALE",
      class: "Class 7",
      section: "B",
      roll_number: "712",
      admission_number: "DPS/2021/0088",
      is_active: true,
    },
  });
  console.log("✅ Student created: Priya Sharma —", priya.id);

  // ── ParentUser ────────────────────────────────────────────────────────────
  const PARENT_PHONE = "+919876543210";
  const parentPi = phoneIndex(PARENT_PHONE);

  let parent = await prisma.parentUser.findUnique({
    where: { phone_index: parentPi },
  });

  if (!parent) {
    parent = await prisma.parentUser.create({
      data: {
        phone: encryptField(PARENT_PHONE),
        phone_index: parentPi,
        name: "Ramesh Sharma",
        is_phone_verified: true,
        status: "ACTIVE",
      },
    });
    console.log(
      "✅ ParentUser created: Ramesh Sharma — phone_index:",
      parentPi.slice(0, 16) + "...",
    );
  } else {
    console.log("⚠️  ParentUser already exists:", parent.id);
  }

  // ── ParentStudent links ───────────────────────────────────────────────────
  await prisma.parentStudent.upsert({
    where: {
      parent_id_student_id: { parent_id: parent.id, student_id: aarav.id },
    },
    update: {},
    create: {
      parent_id: parent.id,
      student_id: aarav.id,
      relationship: "Father",
      is_primary: true,
    },
  });

  await prisma.parentStudent.upsert({
    where: {
      parent_id_student_id: { parent_id: parent.id, student_id: priya.id },
    },
    update: {},
    create: {
      parent_id: parent.id,
      student_id: priya.id,
      relationship: "Father",
      is_primary: false,
    },
  });
  console.log("✅ ParentStudent links created");

  // ── Tokens ────────────────────────────────────────────────────────────────
  const hashAarav = tokenHash();
  const hashPriya = tokenHash();

  const tokenAarav = await prisma.token.create({
    data: {
      school_id: school.id,
      student_id: aarav.id,
      token_hash: hashAarav,
      status: "ACTIVE",
      activated_at: daysAgo(90),
      assigned_at: daysAgo(90),
      expires_at: daysFromNow(275),
    },
  });

  const tokenPriya = await prisma.token.create({
    data: {
      school_id: school.id,
      student_id: priya.id,
      token_hash: hashPriya,
      status: "ISSUED",
      assigned_at: daysAgo(10),
      expires_at: daysFromNow(355),
    },
  });
  console.log("✅ Tokens created — Aarav: ACTIVE, Priya: ISSUED");

  // ── QrAssets ──────────────────────────────────────────────────────────────
  // SuperAdmin id needed — fetch the one from seed.js
  const superAdmin = await prisma.superAdmin.findFirst({
    select: { id: true },
  });

  await prisma.qrAsset.create({
    data: {
      token_id: tokenAarav.id,
      school_id: school.id,
      storage_key: `qr/${school.id}/${tokenAarav.id}.png`,
      public_url: `https://cdn.resqid.in/qr/${school.id}/${tokenAarav.id}.png`,
      format: "PNG",
      width_px: 512,
      height_px: 512,
      qr_type: "BLANK",
      generated_by: superAdmin?.id ?? "system",
      is_active: true,
      generated_at: daysAgo(90),
    },
  });

  await prisma.qrAsset.create({
    data: {
      token_id: tokenPriya.id,
      school_id: school.id,
      storage_key: `qr/${school.id}/${tokenPriya.id}.png`,
      public_url: `https://cdn.resqid.in/qr/${school.id}/${tokenPriya.id}.png`,
      format: "PNG",
      width_px: 512,
      height_px: 512,
      qr_type: "BLANK",
      generated_by: superAdmin?.id ?? "system",
      is_active: true,
      generated_at: daysAgo(10),
    },
  });
  console.log("✅ QrAssets created");

  // ── Cards ─────────────────────────────────────────────────────────────────
  const CARD_NUM_AARAV = `RQ-TST-${crypto.randomBytes(3).toString("hex").toUpperCase()}`;
  const CARD_NUM_PRIYA = `RQ-TST-${crypto.randomBytes(3).toString("hex").toUpperCase()}`;

  await prisma.card.create({
    data: {
      school_id: school.id,
      student_id: aarav.id,
      token_id: tokenAarav.id,
      card_number: CARD_NUM_AARAV,
      print_status: "PRINTED",
      printed_at: daysAgo(90),
    },
  });

  await prisma.card.create({
    data: {
      school_id: school.id,
      student_id: priya.id,
      token_id: tokenPriya.id,
      card_number: CARD_NUM_PRIYA,
      print_status: "PRINTED",
      printed_at: daysAgo(10),
    },
  });
  console.log("✅ Cards created —", CARD_NUM_AARAV, "/", CARD_NUM_PRIYA);

  // ── EmergencyProfiles ─────────────────────────────────────────────────────
  const epAarav = await prisma.emergencyProfile.create({
    data: {
      student_id: aarav.id,
      blood_group: "B_POS",
      allergies: "Penicillin, Peanuts",
      conditions: "Mild Asthma",
      medications: "Salbutamol inhaler (as needed)",
      doctor_name: "Dr. Suresh Kumar",
      doctor_phone_encrypted: encryptField("+911124567890"),
      notes: "Carries inhaler at all times. Allergic to bee stings.",
      visibility: "PUBLIC",
      is_visible: true,
    },
  });

  const epPriya = await prisma.emergencyProfile.create({
    data: {
      student_id: priya.id,
      blood_group: "O_POS",
      allergies: "None known",
      doctor_name: "Dr. Meera Patel",
      doctor_phone_encrypted: encryptField("+911124567891"),
      visibility: "PUBLIC",
      is_visible: true,
    },
  });
  console.log("✅ EmergencyProfiles created");

  // ── EmergencyContacts ─────────────────────────────────────────────────────
  await prisma.emergencyContact.createMany({
    data: [
      // Aarav's contacts
      {
        profile_id: epAarav.id,
        name: "Ramesh Sharma",
        phone_encrypted: encryptField("+919876543210"),
        relationship: "Father",
        priority: 1,
        display_order: 0,
        is_active: true,
        call_enabled: true,
        whatsapp_enabled: true,
      },
      {
        profile_id: epAarav.id,
        name: "Sunita Sharma",
        phone_encrypted: encryptField("+919123456789"),
        relationship: "Mother",
        priority: 2,
        display_order: 1,
        is_active: true,
        call_enabled: true,
        whatsapp_enabled: true,
      },
      // Priya's contacts
      {
        profile_id: epPriya.id,
        name: "Ramesh Sharma",
        phone_encrypted: encryptField("+919876543210"),
        relationship: "Father",
        priority: 1,
        display_order: 0,
        is_active: true,
        call_enabled: true,
        whatsapp_enabled: true,
      },
      {
        profile_id: epPriya.id,
        name: "Sunita Sharma",
        phone_encrypted: encryptField("+919123456789"),
        relationship: "Mother",
        priority: 2,
        display_order: 1,
        is_active: true,
        call_enabled: true,
        whatsapp_enabled: false,
      },
    ],
  });
  console.log("✅ EmergencyContacts created — 2 per student");

  // ── CardVisibility ────────────────────────────────────────────────────────
  await prisma.cardVisibility.createMany({
    data: [
      {
        student_id: aarav.id,
        visibility: "PUBLIC",
        hidden_fields: [],
        updated_by_parent: true,
      },
      {
        student_id: priya.id,
        visibility: "PUBLIC",
        hidden_fields: [],
        updated_by_parent: true,
      },
    ],
  });
  console.log("✅ CardVisibility created — PUBLIC for both");

  // ── ScanLogs ──────────────────────────────────────────────────────────────
  await prisma.scanLog.createMany({
    data: [
      {
        token_id: tokenAarav.id,
        school_id: school.id,
        result: "SUCCESS",
        ip_city: "New Delhi",
        ip_region: "Delhi",
        ip_country: "IN",
        scan_purpose: "EMERGENCY",
        created_at: daysAgo(1),
      },
      {
        token_id: tokenAarav.id,
        school_id: school.id,
        result: "SUCCESS",
        ip_city: "Gurgaon",
        ip_region: "Haryana",
        ip_country: "IN",
        scan_purpose: null,
        created_at: daysAgo(5),
      },
      {
        token_id: tokenAarav.id,
        school_id: school.id,
        result: "RATE_LIMITED",
        ip_city: "New Delhi",
        ip_region: "Delhi",
        ip_country: "IN",
        scan_purpose: null,
        created_at: daysAgo(7),
      },
    ],
  });
  console.log("✅ ScanLogs created — 3 scans for Aarav");

  // ── ScanAnomaly ───────────────────────────────────────────────────────────
  await prisma.scanAnomaly.create({
    data: {
      token_id: tokenAarav.id,
      anomaly_type: "HIGH_FREQUENCY",
      severity: "HIGH",
      reason:
        "3 scans detected within 10 minutes from different IP addresses. Possible card misuse.",
      resolved: false,
      created_at: daysAgo(7),
    },
  });
  console.log("✅ ScanAnomaly created — HIGH_FREQUENCY unresolved\n");

  // ── Summary ───────────────────────────────────────────────────────────────
  console.log("═══════════════════════════════════════════════════════");
  console.log("🎉 Parent seed complete!\n");
  console.log("── Parent App Login (OTP) ──────────────────────────────");
  console.log("   Phone:    +919876543210");
  console.log("   Name:     Ramesh Sharma");
  console.log("   ParentId:", parent.id);
  console.log("");
  console.log("── Students ────────────────────────────────────────────");
  console.log("   Aarav Sharma  (Class 9A) — ACTIVE token — full profile");
  console.log("   Id:", aarav.id, "| Card:", CARD_NUM_AARAV);
  console.log("");
  console.log("   Priya Sharma  (Class 7B) — ISSUED token (activate in app)");
  console.log("   Id:", priya.id, "| Card:", CARD_NUM_PRIYA);
  console.log("");
  console.log("── Home screen will show ───────────────────────────────");
  console.log("   ✅ Hero card with ACTIVE token for Aarav");
  console.log("   ✅ Emergency profile complete (B+, asthma, 2 contacts)");
  console.log("   ✅ Last scan: Emergency scan, 1 day ago, New Delhi");
  console.log("   ✅ Amber anomaly alert banner (HIGH_FREQUENCY)");
  console.log(
    "   ✅ Scan history: 3 entries (1 emergency, 1 success, 1 flagged)",
  );
  console.log("   ✅ Priya's card shows ISSUED — activate button visible");
  console.log("═══════════════════════════════════════════════════════\n");
}

main()
  .catch((e) => {
    console.error("❌ Seed failed:", e.message ?? e);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
