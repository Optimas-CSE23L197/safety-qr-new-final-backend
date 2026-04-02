// src/services/design.service.js
// Card Design Service — handles BLANK and PRE_DETAILS card generation
// =============================================================================

import { PDFDocument, rgb, degrees, StandardFonts } from 'pdf-lib';
import { prisma } from '#config/prisma.js';
import { logger } from '#config/logger.js';
import { initializeStorage, getStorage } from '#infrastructure/storage/storage.index.js';

// =============================================================================
// CONSTANTS
// =============================================================================

const CARD = Object.freeze({
  W: 153,
  H: 243,
});

const SHEET = Object.freeze({
  W: 595,
  H: 842,
  COLS: 3,
  ROWS: 3,
  GAP: 6,
  get MARGIN_X() {
    return (this.W - this.COLS * CARD.W - (this.COLS - 1) * this.GAP) / 2;
  },
  get MARGIN_Y() {
    return (this.H - this.ROWS * CARD.H - (this.ROWS - 1) * this.GAP) / 2;
  },
});

const POS = Object.freeze({
  cardNumber: { x: 119, y: 40, size: 6.5, rotate: -90 },
  schoolName: { x: 10, y: CARD.H - 18, size: 6 },
  studentName: { x: 10, y: CARD.H - 75, size: 10 },
  classText: { x: 10, y: CARD.H - 90, size: 7.5 },
  qr: { x: (CARD.W - 85) / 2, y: (CARD.H - 85) / 2 + 12, size: 85 },
  website: { x: CARD.W / 2 - 22, y: 10, size: 5.5 },
});

const COLOR = Object.freeze({
  orange: rgb(1, 0.353, 0),
  black: rgb(0.039, 0.039, 0.039),
  white: rgb(0.961, 0.941, 0.922),
  dimGrey: rgb(0.267, 0.267, 0.267),
});

// =============================================================================
// HELPERS
// =============================================================================

async function fetchBuffer(url) {
  const res = await fetch(url);
  if (!res.ok) throw new Error(`fetchBuffer: ${res.status} ${url}`);
  return Buffer.from(await res.arrayBuffer());
}

function hexToRgb(hex) {
  const c = hex.replace('#', '');
  return rgb(
    parseInt(c.slice(0, 2), 16) / 255,
    parseInt(c.slice(2, 4), 16) / 255,
    parseInt(c.slice(4, 6), 16) / 255
  );
}

function truncateText(text, font, fontSize, maxWidth) {
  if (!text) return '';
  let t = text;
  while (t.length > 0 && font.widthOfTextAtSize(t, fontSize) > maxWidth) {
    t = t.slice(0, -1);
  }
  return t === text ? text : `${t}…`;
}

async function embedImage(pdfDoc, buffer) {
  try {
    return await pdfDoc.embedPng(buffer);
  } catch {
    return await pdfDoc.embedJpg(buffer);
  }
}

// =============================================================================
// DB QUERIES
// =============================================================================

async function fetchOrderMeta(orderId) {
  return prisma.cardOrder.findUniqueOrThrow({
    where: { id: orderId },
    select: {
      id: true,
      order_number: true,
      order_type: true,
      school_id: true,
      school: {
        select: {
          name: true,
          logo_url: true,
          cardTemplate: {
            select: {
              background_color: true,
              primary_color: true,
              text_color: true,
              front_template_url: true,
              back_template_url: true,
              show_student_name: true,
              show_class: true,
              show_school_name: true,
            },
          },
        },
      },
    },
  });
}

async function fetchBlankItems(orderId) {
  const cards = await prisma.card.findMany({
    where: {
      order_id: orderId,
      file_url: null,
    },
    select: {
      id: true,
      card_number: true,
      token: {
        select: {
          id: true,
          qrAsset: { select: { public_url: true } },
        },
      },
    },
    orderBy: { created_at: 'asc' },
  });

  return cards.map(card => ({
    id: card.id,
    token: {
      qrAsset: card.token?.qrAsset,
      cards: [{ id: card.id, card_number: card.card_number }],
    },
  }));
}

async function fetchPreDetailsItems(orderId) {
  return prisma.cardOrderItem.findMany({
    where: {
      order_id: orderId,
      card_design_url: null,
      pipeline_status: 'COMPLETE',
    },
    select: {
      id: true,
      student_name: true,
      class: true,
      section: true,
      token: {
        select: {
          qrAsset: { select: { public_url: true } },
          cards: {
            where: { order_id: orderId },
            select: { id: true, card_number: true },
            take: 1,
          },
        },
      },
    },
    orderBy: { created_at: 'asc' },
  });
}

// =============================================================================
// CARD STAMPERS
// =============================================================================

async function stampBlankCard(pdfDoc, item, meta, assets) {
  const card = item.token?.cards?.[0];
  if (!card?.card_number) throw new Error(`No card record for item ${item.id}`);

  const { regularFont, frontTemplateBuf, backTemplateBuf } = assets;
  const template = meta.cardTemplate;
  const bgColor = template?.background_color ? hexToRgb(template.background_color) : COLOR.black;
  const accentColor = template?.primary_color ? hexToRgb(template.primary_color) : COLOR.orange;

  const front = pdfDoc.addPage([CARD.W, CARD.H]);

  if (frontTemplateBuf) {
    const img = await embedImage(pdfDoc, frontTemplateBuf);
    front.drawImage(img, { x: 0, y: 0, width: CARD.W, height: CARD.H });
  } else {
    front.drawRectangle({ x: 0, y: 0, width: CARD.W, height: CARD.H, color: bgColor });
  }

  front.drawRectangle({
    x: POS.cardNumber.x - 4,
    y: POS.cardNumber.y - 2,
    width: 22,
    height: 75,
    color: accentColor,
  });
  front.drawText(card.card_number, {
    x: POS.cardNumber.x,
    y: POS.cardNumber.y,
    size: POS.cardNumber.size,
    font: regularFont,
    color: COLOR.black,
    rotate: degrees(POS.cardNumber.rotate),
  });

  const back = pdfDoc.addPage([CARD.W, CARD.H]);
  await stampBackFace(pdfDoc, back, item, meta, assets, bgColor, accentColor, backTemplateBuf);

  return { cardId: card.id, cardNumber: card.card_number };
}

async function stampPreDetailsCard(pdfDoc, item, meta, assets) {
  const card = item.token?.cards?.[0];
  if (!card?.card_number) throw new Error(`No card record for item ${item.id}`);

  const { boldFont, regularFont, frontTemplateBuf, backTemplateBuf } = assets;
  const template = meta.cardTemplate;
  const bgColor = template?.background_color ? hexToRgb(template.background_color) : COLOR.black;
  const accentColor = template?.primary_color ? hexToRgb(template.primary_color) : COLOR.orange;
  const textColor = template?.text_color ? hexToRgb(template.text_color) : COLOR.white;

  const showName = template?.show_student_name ?? true;
  const showClass = template?.show_class ?? true;
  const showSchool = template?.show_school_name ?? true;

  const front = pdfDoc.addPage([CARD.W, CARD.H]);

  if (frontTemplateBuf) {
    const img = await embedImage(pdfDoc, frontTemplateBuf);
    front.drawImage(img, { x: 0, y: 0, width: CARD.W, height: CARD.H });
  } else {
    front.drawRectangle({ x: 0, y: 0, width: CARD.W, height: CARD.H, color: bgColor });
  }

  if (showSchool && meta.school?.name) {
    const text = truncateText(
      meta.school.name.toUpperCase(),
      regularFont,
      POS.schoolName.size,
      CARD.W - 30
    );
    front.drawText(text, {
      x: POS.schoolName.x,
      y: POS.schoolName.y,
      size: POS.schoolName.size,
      font: regularFont,
      color: COLOR.dimGrey,
    });
  }

  if (showName && item.student_name) {
    const text = truncateText(item.student_name, boldFont, POS.studentName.size, CARD.W - 35);
    front.drawText(text, {
      x: POS.studentName.x,
      y: POS.studentName.y,
      size: POS.studentName.size,
      font: boldFont,
      color: textColor,
    });
  }

  if (showClass && item.class) {
    const text = item.section ? `${item.class} — ${item.section}` : item.class;
    front.drawText(text, {
      x: POS.classText.x,
      y: POS.classText.y,
      size: POS.classText.size,
      font: regularFont,
      color: textColor,
    });
  }

  front.drawRectangle({
    x: POS.cardNumber.x - 4,
    y: POS.cardNumber.y - 2,
    width: 22,
    height: 75,
    color: accentColor,
  });
  front.drawText(card.card_number, {
    x: POS.cardNumber.x,
    y: POS.cardNumber.y,
    size: POS.cardNumber.size,
    font: regularFont,
    color: COLOR.black,
    rotate: degrees(POS.cardNumber.rotate),
  });

  const back = pdfDoc.addPage([CARD.W, CARD.H]);
  await stampBackFace(pdfDoc, back, item, meta, assets, bgColor, accentColor, backTemplateBuf);

  return { cardId: card.id, cardNumber: card.card_number };
}

async function stampBackFace(
  pdfDoc,
  page,
  item,
  meta,
  assets,
  bgColor,
  accentColor,
  backTemplateBuf
) {
  const { boldFont, regularFont } = assets;
  const textColor = meta.cardTemplate?.text_color
    ? hexToRgb(meta.cardTemplate.text_color)
    : COLOR.white;

  if (backTemplateBuf) {
    const img = await embedImage(pdfDoc, backTemplateBuf);
    page.drawImage(img, { x: 0, y: 0, width: CARD.W, height: CARD.H });
  } else {
    page.drawRectangle({ x: 0, y: 0, width: CARD.W, height: CARD.H, color: bgColor });
    page.drawRectangle({
      x: 3,
      y: 3,
      width: CARD.W - 6,
      height: CARD.H - 6,
      borderColor: accentColor,
      borderWidth: 1.5,
      color: rgb(0, 0, 0),
      opacity: 0,
    });
  }

  const qrUrl = item.token?.qrAsset?.public_url;
  if (qrUrl) {
    try {
      const qrBuf = await fetchBuffer(qrUrl);
      const qrImg = await pdfDoc.embedPng(qrBuf);
      page.drawImage(qrImg, {
        x: POS.qr.x,
        y: POS.qr.y,
        width: POS.qr.size,
        height: POS.qr.size,
      });
      page.drawText('SCAN IN EMERGENCY', {
        x: POS.qr.x + 5,
        y: POS.qr.y - 12,
        size: 5,
        font: regularFont,
        color: textColor,
      });
    } catch (err) {
      logger.warn({ msg: 'QR fetch failed, skipping', err: err.message });
    }
  }

  const dialY = POS.qr.y - 30;
  page.drawRectangle({ x: 10, y: dialY, width: CARD.W - 20, height: 14, color: accentColor });
  page.drawText('QUICK DIAL', {
    x: CARD.W / 2 - 18,
    y: dialY + 4,
    size: 6,
    font: boldFont,
    color: COLOR.black,
  });

  const emergencyNumbers = [
    { label: 'POLICE', number: '100' },
    { label: 'AMBULANCE', number: '108' },
    { label: 'FIRE', number: '101' },
  ];

  emergencyNumbers.forEach(({ label, number }, idx) => {
    const rowY = dialY - 14 - idx * 13;
    page.drawRectangle({ x: 10, y: rowY, width: 2, height: 11, color: accentColor });
    page.drawText(label, { x: 15, y: rowY + 3, size: 6, font: boldFont, color: textColor });
    page.drawText(number, {
      x: CARD.W - 22,
      y: rowY + 3,
      size: 7,
      font: boldFont,
      color: accentColor,
    });
  });

  page.drawText('getresqid.in', {
    x: POS.website.x,
    y: POS.website.y,
    size: POS.website.size,
    font: regularFont,
    color: textColor,
  });
}

// =============================================================================
// PRINT SHEET COMPOSITOR
// =============================================================================

async function composePrintSheet(cardsPdfBuffer, totalCards) {
  const sheetDoc = await PDFDocument.create();
  const srcDoc = await PDFDocument.load(cardsPdfBuffer);

  const { W, H, COLS, ROWS, GAP, MARGIN_X, MARGIN_Y } = SHEET;
  const cardsPerPage = COLS * ROWS;

  const frontIndices = Array.from({ length: totalCards }, (_, i) => i * 2);
  const backIndices = Array.from({ length: totalCards }, (_, i) => i * 2 + 1);

  async function placeGroup(indices) {
    for (let start = 0; start < indices.length; start += cardsPerPage) {
      const sheetPage = sheetDoc.addPage([W, H]);
      const batch = indices.slice(start, start + cardsPerPage);
      const embedded = await sheetDoc.embedPdf(srcDoc, batch);

      batch.forEach((_, i) => {
        const col = i % COLS;
        const row = Math.floor(i / COLS);
        const x = MARGIN_X + col * (CARD.W + GAP);
        const y = H - MARGIN_Y - CARD.H - row * (CARD.H + GAP);
        sheetPage.drawPage(embedded[i], { x, y, width: CARD.W, height: CARD.H });
      });
    }
  }

  await placeGroup(frontIndices);
  await placeGroup(backIndices);

  return Buffer.from(await sheetDoc.save());
}

// =============================================================================
// MAIN EXPORT
// =============================================================================

export async function generateCards({ orderId, onProgress, customPositions }) {
  logger.info({ msg: 'Starting card generation', orderId });

  // Initialize storage with env values
  let storage;
  try {
    storage = getStorage();
    logger.info({ msg: 'Storage already initialized' });
  } catch (e) {
    logger.info({ msg: 'Initializing storage...' });
    await initializeStorage({
      ENDPOINT: process.env.AWS_S3_ENDPOINT,
      BUCKET: process.env.AWS_S3_BUCKET,
      ACCESS_KEY_ID: process.env.AWS_ACCESS_KEY_ID,
      SECRET_ACCESS_KEY: process.env.AWS_SECRET_ACCESS_KEY,
      CDN_DOMAIN: process.env.AWS_CDN_DOMAIN,
    });
    storage = getStorage();
    logger.info({ msg: 'Storage initialized' });
  }

  const meta = await fetchOrderMeta(orderId);
  const isBlank = meta.order_type === 'BLANK';

  const items = isBlank ? await fetchBlankItems(orderId) : await fetchPreDetailsItems(orderId);

  if (items.length === 0) {
    logger.info({ msg: 'No pending items', orderId });
    return { generated: 0, failed: 0, total: 0, pdfUrl: null };
  }

  const template = meta.cardTemplate;
  const [frontTemplateBuf, backTemplateBuf] = await Promise.all([
    template?.front_template_url
      ? fetchBuffer(template.front_template_url).catch(err => {
          logger.warn({ msg: 'Front template fetch failed', err: err.message });
          return null;
        })
      : null,
    template?.back_template_url
      ? fetchBuffer(template.back_template_url).catch(err => {
          logger.warn({ msg: 'Back template fetch failed', err: err.message });
          return null;
        })
      : null,
  ]);

  const pdfDoc = await PDFDocument.create();
  const boldFont = await pdfDoc.embedFont(StandardFonts.HelveticaBold);
  const regularFont = await pdfDoc.embedFont(StandardFonts.Helvetica);
  const assets = { boldFont, regularFont, frontTemplateBuf, backTemplateBuf };

  const generated = [];
  const failed = [];

  for (let i = 0; i < items.length; i++) {
    const item = items[i];
    try {
      const result = isBlank
        ? await stampBlankCard(pdfDoc, item, meta, assets)
        : await stampPreDetailsCard(pdfDoc, item, meta, assets);

      generated.push(result);

      if (isBlank) {
        await prisma.card.update({
          where: { id: result.cardId },
          data: { file_url: `pending:${result.cardNumber}` },
        });
      } else {
        await prisma.cardOrderItem.update({
          where: { id: item.id },
          data: { card_design_url: `pending:${result.cardNumber}` },
        });
      }

      logger.info({
        msg: 'Card stamped',
        cardNumber: result.cardNumber,
        index: i + 1,
        total: items.length,
      });
    } catch (err) {
      logger.error({ msg: 'Stamp failed', itemId: item.id, err: err.message });
      failed.push({ itemId: item.id, reason: err.message });
    }

    onProgress?.(Math.floor(((i + 1) / items.length) * 90), i + 1, items.length);
  }

  let pdfUrl = null;

  if (generated.length > 0) {
    logger.info({ msg: 'Composing print sheet', cards: generated.length });

    const cardsPdfBuffer = Buffer.from(await pdfDoc.save());
    const printSheet = await composePrintSheet(cardsPdfBuffer, generated.length);

    const storageKey = `orders/${orderId}/print-sheet-${meta.order_number}.pdf`;
    const { location } = await storage.upload(printSheet, storageKey, {
      contentType: 'application/pdf',
      cacheControl: 'private, max-age=86400',
    });
    pdfUrl = location;

    logger.info({ msg: 'Print sheet uploaded', pdfUrl });

    // Update cards with real URL after successful upload
    for (const result of generated) {
      if (isBlank) {
        await prisma.card.update({
          where: { id: result.cardId },
          data: { file_url: pdfUrl },
        });
      } else {
        await prisma.cardOrderItem.update({
          where: { id: result.id },
          data: { card_design_url: pdfUrl },
        });
      }
    }
  }

  onProgress?.(100, items.length, items.length);

  return {
    generated: generated.length,
    failed: failed.length,
    total: items.length,
    pdfUrl,
    generatedCards: generated,
    failedItems: failed,
  };
}

export async function generatePreview({ orderId, itemId, customPositions }) {
  const meta = await fetchOrderMeta(orderId);
  const isBlank = meta.order_type === 'BLANK';

  const item = await prisma.cardOrderItem.findUniqueOrThrow({
    where: { id: itemId },
    select: {
      id: true,
      student_name: true,
      class: true,
      section: true,
      token: {
        select: {
          qrAsset: { select: { public_url: true } },
          cards: {
            where: { order_id: orderId },
            select: { id: true, card_number: true },
            take: 1,
          },
        },
      },
    },
  });

  const template = meta.cardTemplate;
  const [frontTemplateBuf, backTemplateBuf] = await Promise.all([
    template?.front_template_url
      ? fetchBuffer(template.front_template_url).catch(() => null)
      : null,
    template?.back_template_url ? fetchBuffer(template.back_template_url).catch(() => null) : null,
  ]);

  const pdfDoc = await PDFDocument.create();
  const boldFont = await pdfDoc.embedFont(StandardFonts.HelveticaBold);
  const regularFont = await pdfDoc.embedFont(StandardFonts.Helvetica);
  const assets = { boldFont, regularFont, frontTemplateBuf, backTemplateBuf };

  if (isBlank) {
    await stampBlankCard(pdfDoc, item, meta, assets);
  } else {
    await stampPreDetailsCard(pdfDoc, item, meta, assets);
  }

  return Buffer.from(await pdfDoc.save());
}
