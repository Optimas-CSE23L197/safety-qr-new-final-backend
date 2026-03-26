// =============================================================================
// prisma/seed.js — RESQID
// Main seed file - runs all seeders
// =============================================================================

import { prisma } from "../src/config/prisma.js";
import { seedSchools } from "./seed.school.js";
import { seedSuperAdmin } from "./seed.super-admin.js";

async function main() {
  console.log("\n🌱 Starting database seeding...\n");

  // Seed super admin
  await seedSuperAdmin();

  // Seed schools with subscriptions
  await seedSchools();

  console.log("\n🎉 Database seeding completed!\n");
}

main()
  .catch((error) => {
    console.error("\n❌ Seeding failed:", error);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
