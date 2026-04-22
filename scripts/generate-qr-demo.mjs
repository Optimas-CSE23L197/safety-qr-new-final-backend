// scripts/generate-qr-demo.mjs
// Run once: node --import tsx/esm scripts/generate-qr-demo.mjs

import { prisma } from '#config/prisma.js';
import { generateQrPng } from '#services/qr.service.js';
import {
  initializeStorage,
  getStorage,
  StoragePath,
} from '#infrastructure/storage/storage.index.js';

const students = await prisma.student.findMany({
  where: { school: { code: 'CEMK-WB-2025-0001' } },
  include: { tokens: true },
});

await initializeStorage({
  /* your R2 env vars */
});
const storage = getStorage();

for (const student of students) {
  const token = student.tokens[0];
  const qrBuffer = await generateQrPng(student.scan_url);
  const key = StoragePath.studentQrCode(student.id);
  const { location: qrUrl } = await storage.upload(qrBuffer, key, {
    contentType: 'image/png',
    cacheControl: 'public, max-age=31536000',
  });

  await prisma.student.update({
    where: { id: student.id },
    data: { qr_code_url: qrUrl, pipeline_status: 'COMPLETE' },
  });

  await prisma.qrAsset.create({
    data: {
      token_id: token.id,
      school_id: student.school_id,
      storage_key: key,
      public_url: qrUrl,
      format: 'PNG',
      width_px: 512,
      height_px: 512,
      qr_type: 'BLANK',
      generated_by: 'seed-script',
      is_active: true,
    },
  });

  console.log(`✓ ${student.first_name} — ${qrUrl}`);
}
