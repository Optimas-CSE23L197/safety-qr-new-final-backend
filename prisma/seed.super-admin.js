// =============================================================================
// prisma/seed.super-admin.js
// Seed super admin user
// =============================================================================

import { prisma } from "../src/config/prisma.js";
import bcrypt from "bcrypt";

export async function seedSuperAdmin() {
  const superAdminEmail = process.env.SUPER_ADMIN_EMAIL || "admin@corez.com";
  const superAdminPassword = process.env.SUPER_ADMIN_PASSWORD || "Admin@123";

  console.log(`\n👤 Creating Super Admin: ${superAdminEmail}...`);

  const existing = await prisma.superAdmin.findUnique({
    where: { email: superAdminEmail },
  });

  if (existing) {
    console.log(`   ✅ Super Admin already exists: ${superAdminEmail}`);
    return existing;
  }

  const hashedPassword = await bcrypt.hash(superAdminPassword, 12);

  const superAdmin = await prisma.superAdmin.create({
    data: {
      name: "System Administrator",
      email: superAdminEmail,
      password_hash: hashedPassword,
      is_active: true,
    },
  });

  console.log(`   ✅ Super Admin created: ${superAdminEmail}`);
  console.log(`   🔑 Password: ${superAdminPassword}`);
  return superAdmin;
}
