// =============================================================================
// prisma/seed.js — RESQID Demo Seed
// Seeds: 1 School, 4 SuperAdmins, 1 SchoolUser, 5 Students, 5 Tokens
// Tokens are ACTIVE with correct AES-SIV scan codes — QR generation pending
// Run: node prisma/seed.js
// =============================================================================

import { prisma } from '#config/prisma.js';
import bcrypt from 'bcrypt';
import crypto from 'crypto';

// ── We import token helpers directly — same crypto used by pipeline worker ───
import {
  generateRawToken,
  hashRawToken,
  generateScanCode,
  buildScanUrl,
  generateCardNumber,
} from '../src/services/token/token.helpers.js';

const BCRYPT_ROUNDS = 12;
const SCHOOL_SERIAL = 1; // first school

// =============================================================================
// MAIN
// =============================================================================

async function main() {
  console.log('🌱 Starting RESQID demo seed...\n');

  // ── 1. SuperAdmins ──────────────────────────────────────────────────────────
  console.log('👤 Seeding SuperAdmins...');

  const defaultPasswordHash = await bcrypt.hash('Resqid@2025', BCRYPT_ROUNDS);

  const adminDefs = [
    { name: 'Animesh Karan', email: 'karananimesh144@gmail.com' },
    { name: 'Souvik Mahata', email: 'souvikmahata12345@gmail.com' },
    { name: 'Soumya Kumar Ghosh', email: 'ghoshsoumya512@gmail.com' },
    { name: 'Shruti Kumari Mahata', email: 'shrutikumarimahata@gmail.com' },
  ];

  const createdAdmins = [];
  for (const a of adminDefs) {
    const admin = await prisma.superAdmin.upsert({
      where: { email: a.email },
      update: {},
      create: {
        name: a.name,
        email: a.email,
        password_hash: defaultPasswordHash,
        is_active: true,
      },
    });
    createdAdmins.push(admin);
    console.log(`  ✓ ${a.name}`);
  }

  // ── 2. School ───────────────────────────────────────────────────────────────
  console.log('\n🏫 Seeding School...');

  const SCHOOL_CODE = 'CEMK-WB-2025-0001';

  const school = await prisma.school.upsert({
    where: { code: SCHOOL_CODE },
    update: {},
    create: {
      name: 'College of Engineering and Management Kolaghat',
      address: 'K.T.P.P. Township, Kolaghat',
      city: 'Kolaghat',
      state: 'West Bengal',
      pincode: '721171',
      country: 'IN',
      code: SCHOOL_CODE,
      serial_number: SCHOOL_SERIAL,
      email: 'admin@cemkolaghat.ac.in',
      timezone: 'Asia/Kolkata',
      school_type: 'PRIVATE',
      setup_status: 'ACTIVE',
      is_active: true,
      onboarded_by: createdAdmins[0].id,
      onboarded_at: new Date(),
      activated_at: new Date(),
      contract_signed_at: new Date(),
      contract_expires_at: new Date(Date.now() + 365 * 24 * 60 * 60 * 1000),
    },
  });

  console.log(`  ✓ ${school.name} [${school.code}]`);

  // ── School Settings ─────────────────────────────────────────────────────────
  await prisma.schoolSettings.upsert({
    where: { school_id: school.id },
    update: {},
    create: { school_id: school.id },
  });

  // ── 3. SchoolUser (Animesh as primary admin) ────────────────────────────────
  console.log('\n🔑 Seeding SchoolUser...');

  const schoolUser = await prisma.schoolUser.upsert({
    where: { email: 'karananimesh144@gmail.com' },
    update: {},
    create: {
      school_id: school.id,
      email: 'karananimesh144@gmail.com',
      password_hash: defaultPasswordHash,
      name: 'Animesh Karan',
      role: 'ADMIN',
      is_primary: true,
      is_active: true,
      must_change_password: true,
      invited_by: createdAdmins[0].id,
      invite_sent_at: new Date(),
    },
  });

  console.log(`  ✓ ${schoolUser.name} (primary school admin)`);

  // ── 4. Subscription (pilot) ─────────────────────────────────────────────────
  console.log('\n📋 Seeding Subscription...');

  const now = new Date();
  const oneYearLater = new Date(now.getTime() + 365 * 24 * 60 * 60 * 1000);

  // Delete existing to avoid duplicate on re-seed
  await prisma.subscription.deleteMany({ where: { school_id: school.id } });

  const subscription = await prisma.subscription.create({
    data: {
      school_id: school.id,
      plan: 'BASIC',
      status: 'ACTIVE',
      unit_price_snapshot: 0,
      renewal_price_snapshot: 0,
      advance_percent: 0,
      is_pilot: true,
      pilot_expires_at: oneYearLater,
      student_count: 5,
      active_card_count: 5,
      current_period_start: now,
      current_period_end: oneYearLater,
    },
  });

  console.log(`  ✓ Pilot subscription active until ${oneYearLater.toDateString()}`);

  // ── 5. Students + Tokens ────────────────────────────────────────────────────
  console.log('\n🎓 Seeding Students and Tokens...');

  const studentDefs = [
    {
      first_name: 'Animesh',
      last_name: 'Karan',
      class: '4th Year',
      section: 'CSE',
      roll_number: '001',
    },
    {
      first_name: 'Souvik',
      last_name: 'Mahata',
      class: '4th Year',
      section: 'CSE',
      roll_number: '002',
    },
    {
      first_name: 'Soumya',
      last_name: 'Kumar Ghosh',
      class: '4th Year',
      section: 'CSE',
      roll_number: '003',
    },
    {
      first_name: 'Shruti',
      last_name: 'Kumari Mahata',
      class: '4th Year',
      section: 'CSE',
      roll_number: '004',
    },
    {
      first_name: 'Demo',
      last_name: 'Student',
      class: '3rd Year',
      section: 'ECE',
      roll_number: '099',
    },
  ];

  // Clean up existing students for this school on re-seed
  const existingStudents = await prisma.student.findMany({
    where: { school_id: school.id },
    select: { id: true },
  });

  if (existingStudents.length > 0) {
    const ids = existingStudents.map(s => s.id);
    await prisma.emergencyContact.deleteMany({ where: { profile: { student_id: { in: ids } } } });
    await prisma.emergencyProfile.deleteMany({ where: { student_id: { in: ids } } });
    await prisma.card.deleteMany({ where: { student_id: { in: ids } } });
    await prisma.token.deleteMany({ where: { student_id: { in: ids } } });
    await prisma.student.deleteMany({ where: { school_id: school.id } });
    console.log(`  ↺ Cleared ${existingStudents.length} existing students`);
  }

  for (let i = 0; i < studentDefs.length; i++) {
    const s = studentDefs[i];
    const cardNumber = generateCardNumber(SCHOOL_SERIAL);
    const rawToken = generateRawToken();
    const tokenHash = hashRawToken(rawToken);

    // Step 1: Create student (no token refs yet)
    const student = await prisma.student.create({
      data: {
        school_id: school.id,
        first_name: s.first_name,
        last_name: s.last_name,
        class: s.class,
        section: s.section,
        roll_number: s.roll_number,
        profile_type: 'STUDENT',
        setup_stage: 'BASIC',
        is_active: true,
        card_number: cardNumber,
        design_status: 'PENDING',
        pipeline_status: 'PENDING',
      },
    });

    // Step 2: Create token
    const token = await prisma.token.create({
      data: {
        school_id: school.id,
        student_id: student.id,
        token_hash: tokenHash,
        status: 'ACTIVE',
        activated_at: now,
        assigned_at: now,
        expires_at: oneYearLater,
        is_honeypot: false,
      },
    });

    // Step 3: Build AES-SIV scan URL from actual token UUID
    const scanUrl = buildScanUrl(token.id);

    // Step 4: Update student with token refs + scan_url
    await prisma.student.update({
      where: { id: student.id },
      data: {
        token: token.id,
        token_hash: tokenHash,
        scan_url: scanUrl,
      },
    });

    // Step 5: Blank card record (no file_url — pipeline generates design later)
    await prisma.card.create({
      data: {
        school_id: school.id,
        student_id: student.id,
        token_id: token.id,
        card_number: cardNumber,
        print_status: 'PENDING',
      },
    });

    // Step 6: Minimal EmergencyProfile (scan-ready for demo)
    await prisma.emergencyProfile.create({
      data: {
        student_id: student.id,
        blood_group: 'O_POS',
        visibility: 'PUBLIC',
        is_visible: true,
        contacts: {
          create: [
            {
              name: 'Emergency Contact',
              // Base64 placeholder — update via app with real AES-GCM encrypted phone
              phone_encrypted: Buffer.from('placeholder').toString('base64'),
              relationship: 'Parent',
              priority: 1,
              display_order: 1,
              is_active: true,
              call_enabled: true,
              whatsapp_enabled: true,
            },
          ],
        },
      },
    });

    console.log(`  ✓ ${s.first_name} ${s.last_name}`);
    console.log(`    Card    : ${cardNumber}`);
    console.log(`    Scan URL: ${scanUrl}`);
  }

  // ── 6. SchoolAgreement ──────────────────────────────────────────────────────
  console.log('\n📝 Seeding SchoolAgreement...');

  await prisma.schoolAgreement.create({
    data: {
      school_id: school.id,
      subscription_id: subscription.id,
      agreed_by: createdAdmins[0].id,
      agreed_via: 'DASHBOARD',
      is_active: true,
    },
  });

  console.log('  ✓ Agreement recorded');

  // ── Summary ─────────────────────────────────────────────────────────────────
  console.log('\n' + '─'.repeat(60));
  console.log('✅ Seed complete!');
  console.log('─'.repeat(60));
  console.log('🔐 Default password (all accounts) : Resqid@2025');
  console.log('⚠️  Change all passwords after first login');
  console.log('📦 QR codes PENDING — run pipeline worker to generate');
  console.log('📞 Emergency contacts have placeholder phones — update via app');
  console.log('─'.repeat(60) + '\n');
}

main()
  .catch(e => {
    console.error('\n❌ Seed failed:', e.message);
    console.error(e.stack);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
