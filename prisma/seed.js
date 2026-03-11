// =============================================================================
// seed.js — RESQID
// Initial development seed data
// Creates:
// - Super Admin
// - Test School
// - School Settings
// - School Users
// - Test Student + Emergency Profile
// =============================================================================

import "dotenv/config";
import bcrypt from "bcrypt";
import { prisma } from "../src/config/prisma.js";

const SALT_ROUNDS = Number(process.env.SALT_ROUNDS) || 12;

async function main() {
  // ============================================================================
  // SUPER ADMINS
  // ============================================================================

  const superAdmins = [
    {
      name: "Animesh Karan",
      email: "karananimesh144@gmail.com",
      password: "Karan@144#",
    },
  ];

  for (const sa of superAdmins) {
    const email = sa.email.toLowerCase();

    const existing = await prisma.superAdmin.findUnique({
      where: { email },
    });

    if (existing) {
      console.log("⚠️  Super admin already exists:", email);
      continue;
    }

    const password_hash = await bcrypt.hash(sa.password, SALT_ROUNDS);

    const admin = await prisma.superAdmin.create({
      data: {
        name: sa.name,
        email,
        password_hash,
        is_active: true,
      },
    });

    console.log("✅ Super admin created:", admin.email);
  }

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
  }

  // ============================================================================
  // TEST STUDENT
  // ============================================================================

  const student = await prisma.student.create({
    data: {
      school_id: school.id,
      first_name: "Aryan",
      last_name: "Sharma",
      class: "8",
      section: "B",
      is_active: true,
    },
  });

  console.log("✅ Student created:", student.id);

  // ============================================================================
  // EMERGENCY PROFILE
  // ============================================================================

  const existingProfile = await prisma.emergencyProfile.findUnique({
    where: { student_id: student.id },
  });

  if (!existingProfile) {
    await prisma.emergencyProfile.create({
      data: {
        student_id: student.id,
        blood_group: "B_POS",
        visibility: "PUBLIC",
        is_visible: true,
      },
    });

    console.log("✅ Emergency profile created");
  }

  // ============================================================================
  // SUMMARY
  // ============================================================================

  console.log("\n========================================");
  console.log("        SEED DATA SUMMARY");
  console.log("========================================");

  console.log("school_id        :", school.id);

  console.log("----------------------------------------");
  console.log("Super admin login: karananimesh144@gmail.com");
  console.log("Super admin pass : Karan@144#");

  console.log("----------------------------------------");
  console.log("School admin     : schooladmin@test.com");
  console.log("School admin pass: Admin@123#");

  console.log("----------------------------------------");
  console.log("School staff     : schoolstaff@test.com");
  console.log("School staff pass: Staff@123#");

  console.log("========================================\n");
}

main()
  .catch((e) => {
    console.error("❌ Seed failed:", e);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
