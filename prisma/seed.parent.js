import "dotenv/config";
import crypto from "crypto";
import { PrismaClient } from "../src/generated/client.js";
import { PrismaPg } from "@prisma/adapter-pg";

const adapter = new PrismaPg({ connectionString: process.env.DATABASE_URL });
const prisma = new PrismaClient({ adapter });

function generateToken() {
  const raw = crypto.randomBytes(32).toString("hex").toUpperCase();
  const hash = crypto
    .createHmac("sha256", process.env.TOKEN_HASH_SECRET)
    .update(raw)
    .digest("hex");

  return { raw, hash };
}

async function main() {
  console.log("🌱 Parent seed...\n");

  // ── USE SAME SCHOOL ─────────────────────────
  const school = await prisma.school.findUnique({
    where: { code: "TEST-001" },
  });

  if (!school) {
    console.error("Run seed.js first");
    process.exit(1);
  }

  // ── REUSE STUDENTS ─────────────────────────
  const students = await prisma.student.findMany({
    where: { school_id: school.id },
    take: 2,
  });

  if (students.length < 2) {
    console.error("Need students from seed.js");
    process.exit(1);
  }

  const aarav = students[0];
  const priya = students[1];

  // ── PARENT USER ─────────────────────────
  const parent = await prisma.parentUser.create({
    data: {
      phone: "+919876543210",
      phone_index: "test_index",
      name: "Ramesh Sharma",
      is_phone_verified: true,
      status: "ACTIVE",
    },
  });

  // ── LINK ─────────────────────────
  await prisma.parentStudent.createMany({
    data: [
      {
        parent_id: parent.id,
        student_id: aarav.id,
        relationship: "Father",
        is_primary: true,
      },
      {
        parent_id: parent.id,
        student_id: priya.id,
        relationship: "Father",
        is_primary: false,
      },
    ],
  });

  // ── TOKENS (OPTIONAL NEW ONES) ───────────
  const t1 = generateToken();
  const t2 = generateToken();

  await prisma.token.create({
    data: {
      school_id: school.id,
      student_id: aarav.id,
      token_hash: t1.hash,
      status: "ACTIVE",
      assigned_at: new Date(),
      expires_at: new Date(Date.now() + 365 * 24 * 60 * 60 * 1000),
    },
  });

  await prisma.token.create({
    data: {
      school_id: school.id,
      student_id: priya.id,
      token_hash: t2.hash,
      status: "ISSUED",
      assigned_at: new Date(),
      expires_at: new Date(Date.now() + 365 * 24 * 60 * 60 * 1000),
    },
  });

  console.log("\n✅ Parent + student linked successfully");
}

main()
  .catch(console.error)
  .finally(() => prisma.$disconnect());
