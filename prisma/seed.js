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

// ✅ UNIFIED TOKEN SYSTEM
function generateToken() {
  const raw = crypto.randomBytes(32).toString("hex").toUpperCase();
  const hash = crypto
    .createHmac("sha256", process.env.TOKEN_HASH_SECRET)
    .update(raw)
    .digest("hex");

  return { raw, hash };
}

async function main() {
  // ── SUPER ADMIN ─────────────────────────────
  const saEmail = "karananimesh144@gmail.com";

  let superAdmin = await prisma.superAdmin.findUnique({
    where: { email: saEmail },
  });

  if (!superAdmin) {
    const password_hash = await bcrypt.hash("Karan@144#", SALT_ROUNDS);
    superAdmin = await prisma.superAdmin.create({
      data: {
        name: "Animesh Karan",
        email: saEmail,
        password_hash,
        is_active: true,
      },
    });
  }

  // ── SCHOOL ─────────────────────────────
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
  }

  // ── STUDENTS ─────────────────────────────
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

  // ── TOKENS ─────────────────────────────
  const t1 = generateToken();
  const t2 = generateToken();

  const token1 = await prisma.token.create({
    data: {
      school_id: school.id,
      student_id: student1.id,
      token_hash: t1.hash,
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
      token_hash: t2.hash,
      status: "ISSUED",
      assigned_at: daysAgo(10),
      expires_at: daysFromNow(355),
    },
  });

  // ✅ EMPTY TOKEN (IMPORTANT)
  const emptyTokenRaw = generateToken();

  const emptyToken = await prisma.token.create({
    data: {
      school_id: school.id,
      student_id: null,
      token_hash: emptyTokenRaw.hash,
      status: "UNASSIGNED",
      expires_at: daysFromNow(365),
    },
  });

  console.log("\n══════ READY DATA ══════");
  console.log(`@schoolId       = ${school.id}`);
  console.log(`@student1       = ${student1.id}`);
  console.log(`@student2       = ${student2.id}`);
  console.log(`@token1         = ${token1.id}`);
  console.log(`@token2         = ${token2.id}`);
  console.log(`@emptyTokenId   = ${emptyToken.id}`);
  console.log(`@emptyTokenRaw  = ${emptyTokenRaw.raw}  ← USE FOR REGISTRATION`);
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
