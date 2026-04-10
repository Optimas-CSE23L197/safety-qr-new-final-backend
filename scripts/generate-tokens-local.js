// =============================================================================
// scripts/generate-tokens-local.js — RESQID
// Generate tokens for an order directly without queues
// Usage: node scripts/generate-tokens-local.js <orderId>
// =============================================================================

import { prisma } from '#config/prisma.js';
import { logger } from '#config/logger.js';
import { workerRedis } from '#config/redis.js';
import {
  generateRawToken,
  hashRawToken,
  buildScanUrl,
  batchGenerateCardNumbers,
} from '#services/token/token.helpers.js';
import { generateQrPng } from '#services/qr.service.js';
import {
  initializeStorage,
  getStorage,
  StoragePath,
} from '#infrastructure/storage/storage.index.js';

// =============================================================================
// Configuration
// =============================================================================
const TOKEN_BATCH_SIZE = 50;
const QR_PARALLEL = 10;
const BASE_URL = process.env.SCAN_BASE_URL || 'https://getresqid.in/s';

// Override buildScanUrl to use correct base URL
const buildUrl = tokenId => `${BASE_URL}/${tokenId}`;

// =============================================================================
// Main Function
// =============================================================================
async function generateTokensForOrder(orderId) {
  console.log(`\n🔵 Token generation started for order: ${orderId}`);
  console.log('========================================\n');

  try {
    // STEP 1: Fetch order meta to determine type
    const orderMeta = await prisma.cardOrder.findUnique({
      where: { id: orderId },
      select: { order_type: true, order_number: true, school_id: true },
    });

    if (!orderMeta) throw new Error(`Order ${orderId} not found`);
    console.log(`✅ Order: ${orderMeta.order_number}`);
    console.log(`✅ Type: ${orderMeta.order_type}`);

    const isBlank = orderMeta.order_type === 'BLANK';
    const isPreDetails = orderMeta.order_type === 'PRE_DETAILS';

    // STEP 2: Fetch full order with items
    const order = await prisma.cardOrder.findUnique({
      where: { id: orderId },
      include: {
        school: { select: { id: true, serial_number: true, name: true, logo_url: true } },
        items: isBlank
          ? false
          : {
              where: { pipeline_status: { not: 'COMPLETE' } },
              include: { student: true },
              orderBy: { created_at: 'asc' },
            },
      },
    });

    if (!order) throw new Error(`Order ${orderId} not found`);

    const totalStudents = isBlank ? (order.student_count ?? 0) : (order.items?.length ?? 0);
    console.log(`✅ Students to process: ${totalStudents}`);

    if (totalStudents === 0) {
      console.log(`⚠️ No students to process`);
      return { skipped: true, reason: 'No students', total: 0 };
    }

    // STEP 3: Clean up existing tokens (optional - comment out to keep)
    const existingTokens = await prisma.token.count({ where: { order_id: orderId } });
    if (existingTokens > 0) {
      console.log(`⚠️ Found ${existingTokens} existing tokens. Delete? (y/n)`);
      // For automated script, force delete:
      console.log(`🗑️ Deleting existing tokens...`);
      await prisma.token.deleteMany({ where: { order_id: orderId } });
      await prisma.card.deleteMany({ where: { order_id: orderId } });
      await prisma.qrAsset.deleteMany({ where: { order_id: orderId } });
    }

    // STEP 4: Create token batch
    const tokenBatch = await prisma.tokenBatch.create({
      data: {
        school_id: order.school_id,
        order_id: orderId,
        count: totalStudents,
        status: 'PROCESSING',
        created_by: 'local-script',
      },
    });
    console.log(`✅ Token batch created: ${tokenBatch.id}`);

    // STEP 5: Generate card numbers
    const cardNumbers = batchGenerateCardNumbers(order.school.serial_number, totalStudents);
    console.log(`✅ Generated ${cardNumbers.length} card numbers`);

    let generatedCount = 0;
    let failedCount = 0;

    // Build process items array
    const processItems = isBlank
      ? Array.from({ length: totalStudents }, (_, idx) => ({
          id: `blank-${idx}`,
          student_id: null,
          student_name: null,
          class: null,
          section: null,
        }))
      : (order.items ?? []);

    // STEP 6: Initialize storage
    let storage;
    try {
      storage = getStorage();
      console.log(`✅ Storage already initialized`);
    } catch (e) {
      console.log(`🔵 Initializing storage...`);
      await initializeStorage({
        ENDPOINT: process.env.AWS_S3_ENDPOINT,
        BUCKET: process.env.AWS_S3_BUCKET,
        ACCESS_KEY_ID: process.env.AWS_ACCESS_KEY_ID,
        SECRET_ACCESS_KEY: process.env.AWS_SECRET_ACCESS_KEY,
        CDN_DOMAIN: process.env.AWS_CDN_DOMAIN,
      });
      storage = getStorage();
      console.log(`✅ Storage initialized`);
    }

    // STEP 7: Process in batches
    console.log(`\n🔵 Starting batch processing (batch size: ${TOKEN_BATCH_SIZE})`);

    for (let batchStart = 0; batchStart < totalStudents; batchStart += TOKEN_BATCH_SIZE) {
      const batchEnd = Math.min(batchStart + TOKEN_BATCH_SIZE, totalStudents);
      console.log(`\n📦 Batch ${batchStart + 1}-${batchEnd} (${batchEnd - batchStart} items)`);

      const batchItems = processItems.slice(batchStart, batchEnd);
      const batchCardNumbers = cardNumbers.slice(batchStart, batchEnd);

      // Generate raw tokens
      const rawTokens = [];
      const tokenData = [];

      for (let idx = 0; idx < batchItems.length; idx++) {
        const item = batchItems[idx];
        const rawToken = generateRawToken();
        rawTokens.push(rawToken);

        tokenData.push({
          school_id: order.school_id,
          order_id: orderId,
          batch_id: tokenBatch.id,
          token_hash: hashRawToken(rawToken),
          status: isPreDetails && item.student_id ? 'ACTIVE' : 'UNASSIGNED',
          student_id: item.student_id || null,
          order_item_id: isBlank ? null : item.id,
          assigned_at: item.student_id ? new Date() : null,
          activated_at: item.student_id ? new Date() : null,
          expires_at: new Date(Date.now() + 365 * 24 * 60 * 60 * 1000),
        });
      }

      // Bulk insert tokens
      await prisma.token.createMany({ data: tokenData });

      // Fetch created tokens
      const tokens = await prisma.token.findMany({
        where: { order_id: orderId, batch_id: tokenBatch.id },
        orderBy: { created_at: 'asc' },
        skip: batchStart,
        take: batchItems.length,
      });

      // Map raw tokens to token IDs
      const rawTokenMap = new Map();
      for (let i = 0; i < tokens.length; i++) {
        rawTokenMap.set(tokens[i].id, rawTokens[i]);
      }

      // Generate QR codes
      const qrResults = [];

      for (let j = 0; j < tokens.length; j += QR_PARALLEL) {
        const chunk = tokens.slice(j, j + QR_PARALLEL);

        const chunkResults = await Promise.allSettled(
          chunk.map(async (token, idx) => {
            try {
              const item = batchItems[j + idx];
              const cardNumber = batchCardNumbers[j + idx];
              const rawTokenValue = rawTokenMap.get(token.id);

              const scanUrl = buildUrl(token.id);
              const qrBuffer = await generateQrPng(scanUrl);

              const qrKeyStudentId = item.student_id || `pending-${token.id}`;
              const qrKey = StoragePath.studentQrCode(qrKeyStudentId);

              const { location: qrUrl } = await storage.upload(qrBuffer, qrKey, {
                contentType: 'image/png',
                cacheControl: 'public, max-age=31536000',
              });

              return { token, item, rawToken: rawTokenValue, cardNumber, scanUrl, qrUrl };
            } catch (err) {
              console.log(`    ❌ QR failed for token ${token.id}: ${err.message}`);
              throw err;
            }
          })
        );

        for (const settled of chunkResults) {
          if (settled.status === 'fulfilled') {
            qrResults.push(settled.value);
          } else {
            failedCount++;
          }
        }
      }

      console.log(
        `  ✅ QR: ${qrResults.length} success, ${batchItems.length - qrResults.length} failed`
      );

      // Transaction for successful QR results
      if (qrResults.length > 0) {
        await prisma.$transaction(async tx => {
          for (const result of qrResults) {
            await tx.qrAsset.create({
              data: {
                token_id: result.token.id,
                school_id: order.school_id,
                storage_key: `qr-codes/${order.school_id}/${result.item.student_id || result.token.id}.png`,
                public_url: result.qrUrl,
                format: 'PNG',
                width_px: 512,
                height_px: 512,
                qr_type: isPreDetails ? 'PRE_DETAILS' : 'BLANK',
                generated_by: 'local-script',
                order_id: orderId,
                is_active: true,
              },
            });

            await tx.card.create({
              data: {
                school_id: order.school_id,
                student_id: result.item.student_id,
                token_id: result.token.id,
                order_id: orderId,
                card_number: result.cardNumber,
                print_status: 'PENDING',
              },
            });

            if (result.item.student_id) {
              await tx.student.update({
                where: { id: result.item.student_id },
                data: {
                  card_number: result.cardNumber,
                  token: result.token.id,
                  token_hash: result.token.token_hash,
                  scan_url: result.scanUrl,
                  qr_code_url: result.qrUrl,
                  pipeline_status: 'COMPLETE',
                  pipeline_completed_at: new Date(),
                },
              });
            }

            if (!isBlank) {
              await tx.cardOrderItem.update({
                where: { id: result.item.id },
                data: {
                  pipeline_status: 'COMPLETE',
                  status: 'TOKEN_GENERATED',
                },
              });
            }
          }
        });

        generatedCount += qrResults.length;
      }
    }

    // STEP 8: Update token batch status
    const batchStatus = failedCount === 0 ? 'COMPLETE' : generatedCount > 0 ? 'PARTIAL' : 'FAILED';
    await prisma.tokenBatch.update({
      where: { id: tokenBatch.id },
      data: {
        status: batchStatus,
        generated_count: generatedCount,
        failed_count: failedCount,
        completed_at: new Date(),
      },
    });

    // STEP 9: Update order status
    if (generatedCount > 0) {
      await prisma.cardOrder.update({
        where: { id: orderId },
        data: {
          pipeline_completed_count: generatedCount,
          pipeline_started_at: new Date(),
          tokens_generated_at: new Date(),
          status: generatedCount === totalStudents ? 'TOKEN_GENERATED' : 'PARTIALLY_GENERATED',
        },
      });
    }

    console.log('\n========================================');
    console.log(`✅ COMPLETED`);
    console.log(`   Generated: ${generatedCount}`);
    console.log(`   Failed: ${failedCount}`);
    console.log(`   Total: ${totalStudents}`);
    console.log(`   Batch ID: ${tokenBatch.id}`);
    console.log('========================================\n');

    // Print tokens for testing
    if (generatedCount > 0) {
      console.log('\n📋 Generated Tokens (for testing):');
      const tokens = await prisma.token.findMany({
        where: { order_id: orderId },
        select: { id: true, status: true },
        take: 5,
      });
      tokens.forEach(t => {
        console.log(`   ${buildUrl(t.id)} (${t.status})`);
      });
    }

    return {
      success: true,
      batchId: tokenBatch.id,
      generatedCount,
      failedCount,
      total: totalStudents,
    };
  } catch (error) {
    console.error(`\n❌ ERROR: ${error.message}`);
    console.error(error.stack);
    throw error;
  } finally {
    await prisma.$disconnect();
  }
}

// =============================================================================
// CLI Entry Point
// =============================================================================
async function main() {
  const orderId = process.argv[2];

  if (!orderId) {
    console.error('Usage: node scripts/generate-tokens-local.js <orderId>');
    console.error('Example: node scripts/generate-tokens-local.js abc-123-def');
    process.exit(1);
  }

  try {
    await generateTokensForOrder(orderId);
    process.exit(0);
  } catch (error) {
    process.exit(1);
  }
}

// Run if called directly
if (import.meta.url === `file://${process.argv[1]}`) {
  main();
}

export { generateTokensForOrder };
