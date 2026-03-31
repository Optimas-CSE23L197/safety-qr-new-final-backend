// =============================================================================
// scripts/seed-honeypots.js — RESQID
//
// Seeds honeypot tokens for each active school.
// Run once after schema migration or when onboarding a new school.
//
// Usage:
//   node scripts/seed-honeypots.js                    # all schools
//   node scripts/seed-honeypots.js --school=<id>      # one school
//   node scripts/seed-honeypots.js --count=5          # custom count per school
//
// WHAT IS A HONEYPOT TOKEN:
//   A cryptographically valid token that is never printed on a real card.
//   Any scan of a honeypot = instant attacker indicator (zero false positives).
//   The anomaly evaluator detects is_honeypot=true and triggers instant IP block.
//
// SCHEMA REQUIREMENT:
//   Token model must have:  is_honeypot Boolean @default(false)
//   (Add this field to schema.prisma and run prisma migrate dev)
// =============================================================================

import { prisma } from '../src/config/prisma.js';
import { logger } from '../src/config/logger.js';
import { generateScanCode } from '../src/services/token/token.helpers.js';
import crypto from 'crypto';

const DEFAULT_HONEYPOTS_PER_SCHOOL = 3;

const args = process.argv.slice(2).reduce((acc, arg) => {
  const [key, val] = arg.replace('--', '').split('=');
  acc[key] = val;
  return acc;
}, {});

const schoolFilter = args.school ? { id: args.school } : {};
const count = parseInt(args.count ?? DEFAULT_HONEYPOTS_PER_SCHOOL, 10);

const seedHoneypots = async () => {
  const schools = await prisma.school.findMany({
    where: { is_active: true, ...schoolFilter },
    select: { id: true, name: true },
  });

  logger.info({ schools: schools.length, honeypotsPerSchool: count }, '[honeypot] Starting seed');

  for (const school of schools) {
    // Check how many honeypots already exist for this school
    const existing = await prisma.token.count({
      where: { school_id: school.id, is_honeypot: true, status: 'ACTIVE' },
    });

    const needed = Math.max(0, count - existing);
    if (needed === 0) {
      logger.info({ school: school.name }, '[honeypot] School already has enough honeypots — skip');
      continue;
    }

    const tokens = [];
    for (let i = 0; i < needed; i++) {
      const tokenId = crypto.randomUUID();
      const tokenHash = crypto.createHash('sha256').update(tokenId).digest('hex');

      tokens.push({
        id: tokenId,
        school_id: school.id,
        token_hash: tokenHash,
        status: 'ACTIVE', // Active so they pass crypto verify in decodeScanCode
        is_honeypot: true,
        // No student_id, no order_id — these are phantom tokens
      });
    }

    await prisma.token.createMany({ data: tokens, skipDuplicates: true });

    logger.info(
      { school: school.name, created: tokens.length },
      '[honeypot] Honeypot tokens created'
    );
  }

  logger.info('[honeypot] Seed complete');
  await prisma.$disconnect();
};

seedHoneypots().catch(err => {
  logger.error({ err: err.message }, '[honeypot] Seed failed');
  process.exit(1);
});
