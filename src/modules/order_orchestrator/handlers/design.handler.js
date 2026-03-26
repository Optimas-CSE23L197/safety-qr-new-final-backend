// =============================================================================
// handlers/design.handler.js — Order Orchestrator
// Business logic for card design generation with QR and student data.
// =============================================================================

import { prisma } from "../../../config/prisma.js";
import { uploadFile } from "../../../services/storage/storage.service.js";
import { logger } from "../../../config/logger.js";

/**
 * Generate a single card design (PDF/PNG) with QR code and student details.
 * Called by design.worker.js.
 *
 * @param {object} params
 * @param {string} params.cardId
 * @param {object} params.template — School card template
 * @returns {Promise<string>} URL of generated design
 */
export const generateCardDesign = async ({ cardId, template }) => {
  const card = await prisma.card.findUnique({
    where: { id: cardId },
    include: {
      token: {
        include: {
          student: true,
          qrAsset: true,
          orderItem: true,
        },
      },
      order: {
        include: {
          school: true,
        },
      },
    },
  });

  if (!card) {
    throw new Error(`Card ${cardId} not found`);
  }

  const student = card.token?.student;
  const qrAsset = card.token?.qrAsset;
  const school = card.order?.school;
  const orderItem = card.token?.orderItem;

  // Get student name (from student record or order item for PRE_DETAILS)
  const studentName = student?.first_name
    ? `${student.first_name} ${student.last_name || ""}`.trim()
    : orderItem?.student_name || "Student";

  const studentClass = student?.class || orderItem?.class || "";
  const studentSection = student?.section || orderItem?.section || "";
  const studentPhoto = student?.photo_url || orderItem?.photo_url || null;

  // Build card design data
  const designData = {
    cardNumber: card.card_number,
    studentName,
    studentClass,
    studentSection,
    studentPhoto,
    qrUrl: qrAsset?.public_url,
    schoolName: school?.name,
    schoolLogo: school?.logo_url,
    // Template settings
    backgroundColor: template?.background_color || "#FFFFFF",
    primaryColor: template?.primary_color || "#000000",
    textColor: template?.text_color || "#000000",
    qrDarkColor: template?.qr_dark_color || "#000000",
    qrLightColor: template?.qr_light_color || "#FFFFFF",
    showStudentName: template?.show_student_name ?? true,
    showClass: template?.show_class ?? true,
    showSchoolName: template?.show_school_name ?? true,
    showPhoto: template?.show_photo ?? true,
  };

  // In production, this would generate a PDF using a library like puppeteer or pdfkit
  // For now, we'll simulate by creating a placeholder
  const designBuffer = await renderCardDesign(designData);

  // Upload to S3
  const storageKey = `cards/${school?.id}/${card.order_id}/${card.id}.pdf`;
  const designUrl = await uploadFile({
    key: storageKey,
    body: designBuffer,
    contentType: "application/pdf",
    cacheControl: "public, max-age=31536000",
  });

  return designUrl;
};

/**
 * Batch generate card designs for an order.
 */
export const batchGenerateCardDesigns = async ({
  orderId,
  template,
  onProgress,
}) => {
  const order = await prisma.cardOrder.findUnique({
    where: { id: orderId },
    include: {
      cards: {
        where: { file_url: null },
        include: {
          token: {
            include: {
              student: true,
              qrAsset: true,
              orderItem: true,
            },
          },
        },
      },
      school: {
        include: { cardTemplate: true },
      },
    },
  });

  if (!order) {
    throw new Error(`Order ${orderId} not found`);
  }

  const pendingCards = order.cards;
  const results = [];
  const failures = [];

  for (let i = 0; i < pendingCards.length; i++) {
    const card = pendingCards[i];

    try {
      const designUrl = await generateCardDesign({
        cardId: card.id,
        template: template || order.school.cardTemplate,
      });

      // Update card with design URL
      await prisma.card.update({
        where: { id: card.id },
        data: {
          file_url: designUrl,
          print_status: "PENDING",
        },
      });

      results.push({
        cardId: card.id,
        cardNumber: card.card_number,
        designUrl,
      });

      if (onProgress) {
        onProgress(i + 1, pendingCards.length);
      }
    } catch (error) {
      failures.push({
        cardId: card.id,
        cardNumber: card.card_number,
        error: error.message,
      });
      logger.error({
        msg: "Failed to generate card design",
        cardId: card.id,
        error: error.message,
      });
    }
  }

  // Update order with design completion
  if (results.length > 0) {
    await prisma.cardOrder.update({
      where: { id: orderId },
      data: {
        card_design_files: {
          designs_generated: results.length,
          failed: failures.length,
          generated_at: new Date().toISOString(),
          sample_url: results[0]?.designUrl,
        },
        card_design_at: new Date(),
        card_design_by: "system",
      },
    });
  }

  return {
    total: pendingCards.length,
    generated: results.length,
    failed: failures.length,
    failures: failures.slice(0, 100),
    sampleUrl: results[0]?.designUrl,
  };
};

/**
 * Render card design (placeholder — implement with PDF library)
 */
const renderCardDesign = async (data) => {
  // In production, use puppeteer, pdfkit, or similar
  // For now, return empty buffer
  logger.info({
    msg: "Rendering card design",
    cardNumber: data.cardNumber,
    studentName: data.studentName,
  });

  return Buffer.from(`Card design for ${data.studentName}`, "utf-8");
};
