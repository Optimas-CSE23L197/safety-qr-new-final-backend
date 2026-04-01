// =============================================================================
// prisma/seed.school.js — RESQID
// Seed script to create schools with admin users
// Run: node prisma/seed.school.js
// =============================================================================

import { prisma } from '../src/config/prisma.js';
import bcrypt from 'bcrypt';

// ─── Configuration ───────────────────────────────────────────────────────────
export const SCHOOLS = [
  {
    name: 'Delhi Public School',
    code: 'DPS-001',
    email: 'admin@dps.edu',
    phone: '+919876543210',
    city: 'New Delhi',
    state: 'Delhi',
    pincode: '110001',
    school_type: 'PRIVATE',
    pricing_tier: 'PRIVATE_STANDARD',
    is_active: true,
    admin: {
      email: 'admin@dps.edu',
      password: 'Admin@123',
      name: 'Rajesh Kumar',
      role: 'ADMIN',
    },
    subscription: {
      plan: 'PRIVATE_STANDARD',
      status: 'ACTIVE',
      student_count: 500,
      unit_price: 19900,
      renewal_price: 10000,
    },
  },
  {
    name: 'Mumbai International School',
    code: 'MIS-002',
    email: 'admin@mis.edu',
    phone: '+919876543211',
    city: 'Mumbai',
    state: 'Maharashtra',
    pincode: '400001',
    school_type: 'INTERNATIONAL',
    pricing_tier: 'ENTERPRISE',
    is_active: true,
    admin: {
      email: 'admin@mis.edu',
      password: 'Admin@123',
      name: 'Priya Sharma',
      role: 'ADMIN',
    },
    subscription: {
      plan: 'ENTERPRISE',
      status: 'ACTIVE',
      student_count: 1200,
      unit_price: 29900,
      renewal_price: 15000,
    },
  },
  {
    name: 'Government Model School',
    code: 'GMS-003',
    email: 'admin@gms.edu',
    phone: '+919876543212',
    city: 'Bangalore',
    state: 'Karnataka',
    pincode: '560001',
    school_type: 'GOVERNMENT',
    pricing_tier: 'GOVT_STANDARD',
    is_active: true,
    admin: {
      email: 'admin@gms.edu',
      password: 'Admin@123',
      name: 'Suresh Patil',
      role: 'ADMIN',
    },
    subscription: {
      plan: 'GOVT_STANDARD',
      status: 'ACTIVE',
      student_count: 800,
      unit_price: 10000,
      renewal_price: 10000,
    },
  },
  {
    name: 'Chennai Public School',
    code: 'CPS-004',
    email: 'admin@cps.edu',
    phone: '+919876543213',
    city: 'Chennai',
    state: 'Tamil Nadu',
    pincode: '600001',
    school_type: 'PRIVATE',
    pricing_tier: 'PRIVATE_STANDARD',
    is_active: true,
    admin: {
      email: 'admin@cps.edu',
      password: 'Admin@123',
      name: 'Lakshmi Narayanan',
      role: 'ADMIN',
    },
    subscription: {
      plan: 'PRIVATE_STANDARD',
      status: 'ACTIVE',
      student_count: 650,
      unit_price: 19900,
      renewal_price: 10000,
    },
  },
];

// =============================================================================
// HELPER FUNCTIONS
// =============================================================================

export async function createSchool(schoolData) {
  console.log(`\n📚 Creating school: ${schoolData.name}...`);

  // 1. Create School
  const school = await prisma.school.upsert({
    where: { code: schoolData.code },
    update: {},
    create: {
      name: schoolData.name,
      code: schoolData.code,
      email: schoolData.email,
      phone: schoolData.phone,
      city: schoolData.city,
      state: schoolData.state,
      pincode: schoolData.pincode,
      school_type: schoolData.school_type,
      pricing_tier: schoolData.pricing_tier,
      is_active: schoolData.is_active,
    },
  });
  console.log(`   ✅ School created: ${school.name} (${school.code})`);

  // 2. Create School Settings
  await prisma.schoolSettings.upsert({
    where: { school_id: school.id },
    update: {},
    create: {
      school_id: school.id,
      allow_location: false,
      allow_parent_edit: true,
      scan_notifications_enabled: true,
      token_validity_months: 12,
      max_tokens_per_student: 1,
      default_profile_visibility: 'PUBLIC',
    },
  });
  console.log(`   ✅ School settings created`);

  // 3. Create Admin User
  const hashedPassword = await bcrypt.hash(schoolData.admin.password, 12);

  const admin = await prisma.schoolUser.upsert({
    where: { email: schoolData.admin.email },
    update: {},
    create: {
      school_id: school.id,
      email: schoolData.admin.email,
      password_hash: hashedPassword,
      name: schoolData.admin.name,
      role: schoolData.admin.role,
      is_active: true,
    },
  });
  console.log(`   ✅ Admin created: ${admin.email}`);

  // 4. Create Subscription
  const totalAmount = schoolData.subscription.student_count * schoolData.subscription.unit_price;
  const taxAmount = Math.round(totalAmount * 0.18);
  const grandTotal = totalAmount + taxAmount;

  const existingSubscription = await prisma.subscription.findFirst({
    where: { school_id: school.id },
  });

  if (!existingSubscription) {
    await prisma.subscription.create({
      data: {
        school_id: school.id,
        plan: schoolData.subscription.plan,
        status: schoolData.subscription.status,
        pricing_tier: schoolData.pricing_tier,
        student_count: schoolData.subscription.student_count,
        unit_price: schoolData.subscription.unit_price,
        grand_total: grandTotal,
        current_period_start: new Date(),
        current_period_end: new Date(Date.now() + 365 * 24 * 60 * 60 * 1000),
      },
    });
    console.log(
      `   ✅ Subscription created (₹${(schoolData.subscription.unit_price / 100).toFixed(2)}/student)`
    );
  } else {
    console.log(`   ⏭️  Subscription already exists, skipping...`);
  }

  // 5. Create a test student (FIXED - use create instead of upsert)
  try {
    const student = await prisma.student.create({
      data: {
        school_id: school.id,
        first_name: 'Test',
        last_name: 'Student',
        class: '10',
        section: 'A',
        setup_stage: 'BASIC',
        is_active: true,
      },
    });
    console.log(`   ✅ Test student created: ${student.first_name} ${student.last_name}`);
  } catch (error) {
    // Student might already exist, that's fine
    console.log(`   ⏭️  Test student already exists, skipping...`);
  }

  return { school, admin };
}

// =============================================================================
// MAIN SEED FUNCTION (export this for use in seed.js)
// =============================================================================

export async function seedSchools() {
  console.log('\n╔══════════════════════════════════════════════════════════════╗');
  console.log('║              🌱 SEEDING SCHOOLS & ADMINS                     ║');
  console.log('╚══════════════════════════════════════════════════════════════╝\n');

  for (const schoolData of SCHOOLS) {
    try {
      await createSchool(schoolData);
    } catch (error) {
      console.error(`   ❌ Failed to create ${schoolData.name}:`, error.message);
    }
  }

  // Display summary
  console.log('\n╔══════════════════════════════════════════════════════════════╗');
  console.log('║              🎉 SCHOOL SEEDING COMPLETE!                     ║');
  console.log('╚══════════════════════════════════════════════════════════════╝');
  console.log('\n📋 School Login Credentials:');
  console.log('┌─────────────────────────────────────────────────────────────┐');

  for (let i = 0; i < SCHOOLS.length; i++) {
    const school = SCHOOLS[i];
    console.log(`│ ${i + 1}. ${school.name.padEnd(40)} │`);
    console.log(`│    Email:    ${school.admin.email.padEnd(35)} │`);
    console.log(`│    Password: ${school.admin.password.padEnd(35)} │`);
    console.log(`│    School:   ${school.code.padEnd(35)} │`);
    if (i < SCHOOLS.length - 1)
      console.log(`├─────────────────────────────────────────────────────────────┤`);
  }

  console.log('└─────────────────────────────────────────────────────────────┘');
  console.log('\n🔗 Test Login: POST http://localhost:3000/api/v1/auth/school');
  console.log('   Body: { "email": "admin@dps.edu", "password": "Admin@123" }\n');
}

// =============================================================================
// RUN SEED (if called directly)
// =============================================================================

if (import.meta.url === `file://${process.argv[1]}`) {
  seedSchools()
    .catch(error => {
      console.error('\n❌ Seeding failed:', error);
      process.exit(1);
    })
    .finally(async () => {
      await prisma.$disconnect();
      console.log('🔌 Database connection closed\n');
    });
}
