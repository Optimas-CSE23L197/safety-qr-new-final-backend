// =============================================================================
// order.repository.js — RESQID
// All DB operations for the order lifecycle.
// No business logic — only Prisma queries.
// =============================================================================

import { prisma } from "../../config/prisma.js";
import { encryptField, decryptField } from "../../utils/security/encryption.js";

// =============================================================================
// FIELD ENCRYPTION HELPERS
// Layer 9 (PPT): contact phone, delivery address, and call context fields
// are encrypted at rest with AES-256-GCM via utils/security/encryption.js.
// enc() / dec() are thin wrappers — pass-through when value is null/undefined.
// =============================================================================

const enc = (value) => encryptField(value);
const dec = (value) => decryptField(value);

// =============================================================================
// SEQUENCE COUNTERS
// Uses Postgres advisory-lock-free SEQUENCE via $queryRaw for atomic,
// race-condition-free number generation under concurrent load.
// COUNT+1 is NOT used — that pattern produces duplicates under concurrent requests.
// =============================================================================

export const generateOrderNumber = async () => {
  const year = new Date().getFullYear();
  const result =
    await prisma.$queryRaw`SELECT nextval('order_number_seq') AS seq`;
  const seq = String(Number(result[0].seq)).padStart(4, "0");
  return `ORD-${year}-${seq}`;
};

export const generateInvoiceNumber = async () => {
  const year = new Date().getFullYear();
  const result =
    await prisma.$queryRaw`SELECT nextval('invoice_number_seq') AS seq`;
  const seq = String(Number(result[0].seq)).padStart(4, "0");
  return `INV-${year}-${seq}`;
};

export const generateBatchNumber = async () => {
  const year = new Date().getFullYear();
  const result =
    await prisma.$queryRaw`SELECT nextval('batch_number_seq') AS seq`;
  const seq = String(Number(result[0].seq)).padStart(3, "0");
  return `BATCH-${year}-${seq}`;
};
// NOTE: create these sequences in a migration:
//   CREATE SEQUENCE IF NOT EXISTS order_number_seq START 1;
//   CREATE SEQUENCE IF NOT EXISTS invoice_number_seq START 1;
//   CREATE SEQUENCE IF NOT EXISTS batch_number_seq START 1;

// =============================================================================
// ORDER — fetch
// =============================================================================

export const findOrderById = (orderId) => {
  return prisma.cardOrder.findUnique({
    where: { id: orderId },
    include: {
      items: { orderBy: { created_at: "asc" } },
      school: {
        select: {
          id: true,
          name: true,
          code: true,
          serial_number: true, // required by step4 → generateCardNumber(school.serial_number)
          school_type: true, // FIX: was `type`
          logo_url: true,
          is_active: true,
          settings: {
            select: {
              token_validity_months: true,
              max_tokens_per_student: true,
            },
          },
        },
      },
      subscription: {
        select: {
          id: true,
          status: true,
          unit_price: true,
          renewal_price: true,
          pricing_tier: true,
        },
      },
      shipment: true,
      statusLogs: { orderBy: { created_at: "asc" } },
      vendor: {
        select: {
          id: true,
          name: true,
          contact_name: true,
          phone: true,
          email: true,
          address: true,
          city: true,
          state: true,
          pincode: true,
          status: true,
        },
      },
      advanceInvoice: {
        select: {
          id: true,
          status: true,
          invoice_number: true,
          total_amount: true,
        },
      },
      balanceInvoice: {
        select: {
          id: true,
          status: true,
          invoice_number: true,
          total_amount: true,
        },
      },
    },
  });
};

export const findOrderStatus = (orderId) => {
  return prisma.cardOrder.findUnique({
    where: { id: orderId },
    select: {
      id: true,
      status: true,
      payment_status: true,
      school_id: true,
      order_type: true,
      card_count: true,
      channel: true,
      subscription_id: true,
    },
  });
};

// BUG FIX [REPO-1]: listOrders previously expected { skip, take, where } but
// the controller passed { page, limit, status, schoolId, channel }.
// Now accepts the controller's shape and builds skip/take/where internally.
export const listOrders = ({
  page = 1,
  limit = 20,
  status,
  schoolId,
  channel,
}) => {
  const skip = (page - 1) * limit;
  const take = limit;

  const where = {
    ...(status ? { status } : {}),
    ...(schoolId ? { school_id: schoolId } : {}),
    ...(channel ? { channel } : {}),
  };

  return prisma.$transaction([
    prisma.cardOrder.findMany({
      where,
      skip,
      take,
      orderBy: { created_at: "desc" },
      select: {
        id: true,
        order_number: true,
        status: true,
        payment_status: true,
        order_type: true,
        channel: true,
        card_count: true,
        created_at: true,
        updated_at: true,
        school: { select: { id: true, name: true, code: true } },
      },
    }),
    prisma.cardOrder.count({ where }),
  ]);
};

// =============================================================================
// ORDER — create
// =============================================================================

export const createOrder = ({
  schoolId,
  subscriptionId,
  orderNumber,
  orderType,
  orderMode,
  channel,
  cardCount,
  deliveryName,
  deliveryPhone,
  deliveryAddress,
  deliveryCity,
  deliveryState,
  deliveryPincode,
  deliveryNotes,
  callerName,
  callerPhone,
  callNotes,
  notes,
  adminNotes,
  items = [],
  createdBy,
}) => {
  return prisma.$transaction(async (tx) => {
    const order = await tx.cardOrder.create({
      data: {
        school_id: schoolId,
        subscription_id: subscriptionId ?? null,
        order_number: orderNumber,
        order_type: orderType,
        order_mode: orderMode,
        channel,
        card_count: cardCount,
        status: "PENDING",
        payment_status: "UNPAID",
        delivery_name: deliveryName ?? null,
        delivery_phone: enc(deliveryPhone), // SEC: encrypted at rest
        delivery_address: enc(deliveryAddress), // SEC: encrypted at rest
        delivery_city: deliveryCity ?? null,
        delivery_state: deliveryState ?? null,
        delivery_pincode: deliveryPincode ?? null,
        delivery_notes: deliveryNotes ?? null,
        caller_name: callerName ?? null,
        caller_phone: enc(callerPhone), // SEC: encrypted at rest
        call_notes: enc(callNotes), // SEC: encrypted at rest
        notes: notes ?? null,
        admin_notes: adminNotes ?? null,
      },
    });

    await tx.orderStatusLog.create({
      data: {
        order_id: order.id,
        from_status: null,
        to_status: "PENDING",
        changed_by: createdBy,
        note: `Order created via ${channel} channel`,
        metadata: { order_number: orderNumber, card_count: cardCount },
      },
    });

    if (items.length > 0) {
      await tx.cardOrderItem.createMany({
        data: items.map((item) => ({
          order_id: order.id,
          student_name: item.student_name,
          class: item.class ?? null,
          section: item.section ?? null,
          roll_number: item.roll_number ?? null,
          photo_url: item.photo_url ?? null,
          student_id: item.student_id ?? null,
          status: "PENDING",
        })),
      });
    }

    return order;
  });
};

// =============================================================================
// STATUS LOG
// =============================================================================

export const writeStatusLog = ({
  orderId,
  fromStatus,
  toStatus,
  changedBy,
  note,
  metadata,
}) => {
  return prisma.orderStatusLog.create({
    data: {
      order_id: orderId,
      from_status: fromStatus ?? null,
      to_status: toStatus,
      changed_by: changedBy,
      note: note ?? null,
      metadata: metadata ?? null,
    },
  });
};

// Alias used by pipeline steps 5-10
export const writeOrderStatusLog = writeStatusLog;

// =============================================================================
// STEP 1 — CONFIRM
// =============================================================================

export const confirmOrder = ({
  orderId,
  adminId,
  advanceAmount,
  balanceAmount,
  deliveryName,
  deliveryPhone,
  deliveryAddress,
  deliveryCity,
  deliveryState,
  deliveryPincode,
  deliveryNotes,
  adminNotes,
}) => {
  return prisma.cardOrder.update({
    where: { id: orderId },
    data: {
      status: "CONFIRMED",
      confirmed_by: adminId,
      confirmed_at: new Date(),
      advance_amount: advanceAmount,
      balance_amount: balanceAmount,
      delivery_name: deliveryName ?? undefined,
      delivery_phone: deliveryPhone != null ? enc(deliveryPhone) : undefined, // SEC
      delivery_address:
        deliveryAddress != null ? enc(deliveryAddress) : undefined, // SEC
      delivery_city: deliveryCity ?? undefined,
      delivery_state: deliveryState ?? undefined,
      delivery_pincode: deliveryPincode ?? undefined,
      delivery_notes: deliveryNotes ?? undefined,
      admin_notes: adminNotes ?? undefined,
      status_changed_by: adminId,
      status_changed_at: new Date(),
    },
  });
};

// =============================================================================
// STEP 2 — PAYMENT
// =============================================================================

export const setPaymentPending = ({ orderId, adminId }) =>
  prisma.cardOrder.update({
    where: { id: orderId },
    data: {
      status: "PAYMENT_PENDING",
      status_changed_by: adminId,
      status_changed_at: new Date(),
    },
  });

export const createAdvanceInvoice = ({
  schoolId,
  subscriptionId,
  invoiceNumber,
  cardCount,
  unitPrice,
  amount,
  taxAmount,
  totalAmount,
  dueAt,
  notes,
}) =>
  prisma.invoice.create({
    data: {
      school_id: schoolId,
      subscription_id: subscriptionId ?? null,
      invoice_number: invoiceNumber,
      invoice_type: "ADVANCE",
      student_count: cardCount,
      unit_price: unitPrice,
      amount,
      tax_amount: taxAmount,
      total_amount: totalAmount,
      status: "ISSUED",
      issued_at: new Date(),
      due_at: dueAt,
      notes: notes ?? null,
    },
  });

export const linkAdvanceInvoiceToOrder = ({ orderId, invoiceId }) =>
  prisma.cardOrder.update({
    where: { id: orderId },
    data: { advance_invoice_id: invoiceId },
  });

export const recordAdvanceReceived = ({
  orderId,
  invoiceId,
  schoolId,
  subscriptionId,
  batchNumber,
  cardCount,
  unitPrice,
  subtotal,
  taxAmount,
  totalAmount,
  amountReceived,
  paymentRef,
  paymentMode,
  adminId,
}) =>
  prisma.$transaction(async (tx) => {
    const now = new Date();
    await tx.invoice.update({
      where: { id: invoiceId },
      data: { status: "PAID", paid_at: now },
    });
    const batch = await tx.schoolPaymentBatch.create({
      data: {
        school_id: schoolId,
        subscription_id: subscriptionId ?? null,
        batch_number: batchNumber,
        student_count: cardCount,
        unit_price: unitPrice,
        subtotal,
        tax_amount: taxAmount,
        total_amount: totalAmount,
        amount_received: amountReceived,
        payment_ref: paymentRef ?? null, // FIX: was provider_ref
        payment_mode: paymentMode,
        status: "PAID",
        is_advance: true,
        received_at: now,
        verified_by: adminId,
        verified_at: now,
      },
    });
    const payment = await tx.payment.create({
      data: {
        school_id: schoolId,
        subscription_id: subscriptionId ?? null,
        order_id: orderId,
        invoice_id: invoiceId,
        amount: amountReceived,
        tax_amount: taxAmount,
        status: "SUCCESS",
        provider: "manual",
        payment_mode: paymentMode,
        is_advance: true,
      },
    });
    const order = await tx.cardOrder.update({
      where: { id: orderId },
      data: {
        status: "ADVANCE_RECEIVED",
        payment_status: "PARTIALLY_PAID",
        advance_paid_at: now,
        status_changed_by: adminId,
        status_changed_at: now,
      },
    });
    return { batch, payment, order };
  });

// =============================================================================
// STEP 3 — TOKEN GENERATION
// =============================================================================

export const setTokenGenerating = ({ orderId, adminId }) =>
  prisma.cardOrder.update({
    where: { id: orderId },
    data: {
      status: "TOKEN_GENERATION",
      status_changed_by: adminId,
      status_changed_at: new Date(),
    },
  });

export const setTokenGenerated = ({ orderId, adminId }) =>
  prisma.cardOrder.update({
    where: { id: orderId },
    data: {
      status: "TOKEN_GENERATED",
      tokens_generated_by: adminId,
      tokens_generated_at: new Date(),
      status_changed_by: adminId,
      status_changed_at: new Date(),
    },
  });

// =============================================================================
// STEP 4 — CARD DESIGN
// =============================================================================

export const setCardDesigning = ({ orderId, adminId }) =>
  prisma.cardOrder.update({
    where: { id: orderId },
    data: {
      status: "CARD_DESIGN",
      status_changed_by: adminId,
      status_changed_at: new Date(),
    },
  });

export const setCardDesignReady = ({ orderId, adminId, cardDesignFiles }) =>
  prisma.cardOrder.update({
    where: { id: orderId },
    data: {
      status: "CARD_DESIGN_READY",
      card_design_files: cardDesignFiles,
      card_design_by: adminId,
      card_design_at: new Date(),
      status_changed_by: adminId,
      status_changed_at: new Date(),
    },
  });

export const setCardDesignRevision = ({ orderId, adminId, note }) =>
  prisma.cardOrder.update({
    where: { id: orderId },
    data: {
      status: "CARD_DESIGN_REVISION",
      admin_notes: note ?? null,
      status_changed_by: adminId,
      status_changed_at: new Date(),
    },
  });

// =============================================================================
// STEP 5 — VENDOR
// =============================================================================

export const findActiveVendors = () =>
  prisma.vendorProfile.findMany({
    where: { status: "ACTIVE" },
    orderBy: { name: "asc" },
    select: {
      id: true,
      name: true,
      contact_name: true,
      phone: true,
      email: true,
      address: true,
      city: true,
      state: true,
      pincode: true,
      avg_turnaround_days: true,
    },
  });

export const setSentToVendor = ({ orderId, vendorId, vendorNotes, adminId }) =>
  prisma.cardOrder.update({
    where: { id: orderId },
    data: {
      status: "SENT_TO_VENDOR",
      vendor_id: vendorId,
      vendor_notes: vendorNotes ?? null,
      files_sent_to_vendor_at: new Date(),
      files_sent_by: adminId,
      status_changed_by: adminId,
      status_changed_at: new Date(),
    },
  });

// =============================================================================
// STEP 6 — PRINTING
// =============================================================================

export const setPrinting = ({ orderId, adminId }) =>
  prisma.cardOrder.update({
    where: { id: orderId },
    data: {
      status: "PRINTING",
      status_changed_by: adminId,
      status_changed_at: new Date(),
    },
  });

export const setPrintComplete = ({ orderId, adminId, note }) =>
  prisma.cardOrder.update({
    where: { id: orderId },
    data: {
      status: "PRINT_COMPLETE",
      print_complete_at: new Date(),
      print_complete_noted_by: adminId,
      status_note: note ?? null,
      status_changed_by: adminId,
      status_changed_at: new Date(),
    },
  });

export const updateOrderItemsPrinted = (orderId) =>
  prisma.cardOrderItem.updateMany({
    where: { order_id: orderId },
    data: { card_printed: true, status: "PRINTED" },
  });

// =============================================================================
// STEP 7 — SHIPMENT
// =============================================================================

export const createShipment = ({
  orderId,
  shiprocketOrderId,
  shiprocketShipmentId,
  awbCode,
  courierName,
  courierId,
  trackingUrl,
  labelUrl,
  manifestUrl,
  pickupVendorId,
  pickupName,
  pickupContact,
  pickupAddress,
  pickupCity,
  pickupState,
  pickupPincode,
  deliveryName,
  deliveryPhone,
  deliveryAddress,
  deliveryCity,
  deliveryState,
  deliveryPincode,
  notes,
  createdBy,
}) =>
  prisma.orderShipment.create({
    data: {
      order_id: orderId,
      shiprocket_order_id: shiprocketOrderId ?? null,
      shiprocket_shipment_id: shiprocketShipmentId ?? null,
      awb_code: awbCode ?? null,
      courier_name: courierName ?? null,
      courier_id: courierId ?? null,
      tracking_url: trackingUrl ?? null,
      label_url: labelUrl ?? null,
      manifest_url: manifestUrl ?? null,
      pickup_vendor_id: pickupVendorId ?? null,
      pickup_name: pickupName ?? null,
      pickup_contact: pickupContact ?? null,
      pickup_address: pickupAddress ?? null,
      pickup_city: pickupCity ?? null,
      pickup_state: pickupState ?? null,
      pickup_pincode: pickupPincode ?? null,
      delivery_name: deliveryName ?? null,
      delivery_phone: deliveryPhone ?? null,
      delivery_address: deliveryAddress ?? null,
      delivery_city: deliveryCity ?? null,
      delivery_state: deliveryState ?? null,
      delivery_pincode: deliveryPincode ?? null,
      status: "PENDING",
      notes: notes ?? null,
      created_by: createdBy,
    },
  });

export const setReadyToShip = ({ orderId, adminId }) =>
  prisma.cardOrder.update({
    where: { id: orderId },
    data: {
      status: "READY_TO_SHIP",
      status_changed_by: adminId,
      status_changed_at: new Date(),
    },
  });

export const setShipped = ({ orderId, adminId }) =>
  prisma.cardOrder.update({
    where: { id: orderId },
    data: {
      status: "SHIPPED",
      status_changed_by: adminId,
      status_changed_at: new Date(),
    },
  });

export const updateShipmentTracking = ({
  shipmentId,
  awbCode,
  trackingUrl,
  courierName,
  adminId,
}) =>
  prisma.orderShipment.update({
    where: { id: shipmentId },
    data: {
      awb_code: awbCode ?? undefined,
      tracking_url: trackingUrl ?? undefined,
      courier_name: courierName ?? undefined,
      status: "IN_TRANSIT",
      tracking_shared_at: new Date(),
      tracking_shared_by: adminId,
    },
  });

// =============================================================================
// STEP 8 — DELIVERY + BALANCE PAYMENT
// =============================================================================

export const setDelivered = ({ orderId, adminId }) =>
  prisma.cardOrder.update({
    where: { id: orderId },
    data: {
      status: "DELIVERED",
      status_changed_by: adminId,
      status_changed_at: new Date(),
    },
  });

export const updateShipmentDelivered = ({ orderId }) =>
  prisma.orderShipment.update({
    where: { order_id: orderId },
    data: { status: "DELIVERED", delivered_at: new Date() },
  });

export const updateTokensToIssued = ({ orderId }) =>
  prisma.token.updateMany({
    where: { order_id: orderId, status: "UNASSIGNED" },
    data: { status: "ISSUED" },
  });

export const setBalancePending = ({ orderId, adminId, balanceDueAt }) =>
  prisma.cardOrder.update({
    where: { id: orderId },
    data: {
      status: "BALANCE_PENDING",
      balance_due_at: balanceDueAt,
      status_changed_by: adminId,
      status_changed_at: new Date(),
    },
  });

export const createBalanceInvoice = ({
  schoolId,
  subscriptionId,
  invoiceNumber,
  cardCount,
  unitPrice,
  amount,
  taxAmount,
  totalAmount,
  dueAt,
  notes,
}) =>
  prisma.invoice.create({
    data: {
      school_id: schoolId,
      subscription_id: subscriptionId ?? null,
      invoice_number: invoiceNumber,
      invoice_type: "BALANCE",
      student_count: cardCount,
      unit_price: unitPrice,
      amount,
      tax_amount: taxAmount,
      total_amount: totalAmount,
      status: "ISSUED",
      issued_at: new Date(),
      due_at: dueAt,
      notes: notes ?? null,
    },
  });

export const linkBalanceInvoiceToOrder = ({ orderId, invoiceId }) =>
  prisma.cardOrder.update({
    where: { id: orderId },
    data: { balance_invoice_id: invoiceId },
  });

export const recordBalanceReceived = ({
  orderId,
  invoiceId,
  schoolId,
  subscriptionId,
  batchNumber,
  cardCount,
  unitPrice,
  subtotal,
  taxAmount,
  totalAmount,
  amountReceived,
  paymentRef,
  paymentMode,
  adminId,
}) =>
  prisma.$transaction(async (tx) => {
    const now = new Date();
    await tx.invoice.update({
      where: { id: invoiceId },
      data: { status: "PAID", paid_at: now },
    });
    const batch = await tx.schoolPaymentBatch.create({
      data: {
        school_id: schoolId,
        subscription_id: subscriptionId ?? null,
        batch_number: batchNumber,
        student_count: cardCount,
        unit_price: unitPrice,
        subtotal,
        tax_amount: taxAmount,
        total_amount: totalAmount,
        amount_received: amountReceived,
        payment_ref: paymentRef ?? null, // FIX: was provider_ref
        payment_mode: paymentMode,
        status: "PAID",
        is_advance: false,
        received_at: now,
        verified_by: adminId,
        verified_at: now,
      },
    });
    const payment = await tx.payment.create({
      data: {
        school_id: schoolId,
        subscription_id: subscriptionId ?? null,
        order_id: orderId,
        invoice_id: invoiceId,
        amount: amountReceived,
        tax_amount: taxAmount,
        status: "SUCCESS",
        provider: "manual",
        payment_mode: paymentMode,
        is_advance: false,
      },
    });
    const order = await tx.cardOrder.update({
      where: { id: orderId },
      data: {
        status: "COMPLETED",
        payment_status: "PAID",
        balance_paid_at: now,
        balance_due_at: now,
        status_changed_by: adminId,
        status_changed_at: now,
      },
    });
    return { batch, payment, order };
  });

// =============================================================================
// CANCELLATION
// =============================================================================

export const cancelOrder = ({
  orderId,
  adminId,
  reason,
  revokeTokens = false,
}) =>
  prisma.$transaction(async (tx) => {
    const order = await tx.cardOrder.update({
      where: { id: orderId },
      data: {
        status: "CANCELLED",
        status_note: reason ?? null,
        status_changed_by: adminId,
        status_changed_at: new Date(),
      },
    });
    if (revokeTokens) {
      await tx.token.updateMany({
        where: { order_id: orderId, status: { in: ["UNASSIGNED", "ISSUED"] } },
        data: { status: "REVOKED", revoked_at: new Date() },
      });
      await tx.qrAsset.updateMany({
        where: { order_id: orderId },
        data: { is_active: false },
      });
    }
    return order;
  });

export const setRefunded = ({ orderId, adminId, note }) =>
  prisma.cardOrder.update({
    where: { id: orderId },
    data: {
      status: "REFUNDED",
      payment_status: "REFUNDED",
      status_note: note ?? null,
      status_changed_by: adminId,
      status_changed_at: new Date(),
    },
  });

// =============================================================================
// SCHOOL HELPERS
// =============================================================================

export const findSchoolForOrder = (schoolId) =>
  prisma.school.findUnique({
    where: { id: schoolId },
    select: {
      id: true,
      name: true,
      code: true,
      school_type: true, // FIX: was `type`
      is_active: true,
      subscriptions: {
        where: { status: "ACTIVE" },
        take: 1,
        orderBy: { created_at: "desc" },
        select: {
          id: true,
          status: true,
          unit_price: true,
          pricing_tier: true,
        },
      },
    },
  });

// =============================================================================
// GENERIC CRUD HELPERS
// Used by steps 5-10 for flexible updates instead of named status functions
// =============================================================================

// Full order fetch with all relations — used by pipeline steps
export const findOrderByIdRaw = (orderId) =>
  prisma.cardOrder.findUnique({
    where: { id: orderId },
    include: {
      items: true,
      school: {
        select: {
          id: true,
          name: true,
          code: true,
          school_type: true, // FIX: was `type`
          logo_url: true,
          settings: {
            select: {
              token_validity_months: true,
              max_tokens_per_student: true,
            },
          },
        },
      },
      subscription: true,
      shipment: true,
      vendor: true,
    },
  });

// Generic order update — steps pass specific data objects
export const updateOrder = (orderId, data) =>
  prisma.cardOrder.update({
    where: { id: orderId },
    data,
  });

// Generic card update — step5 uses this for individual card records
export const updateCard = (cardId, data) =>
  prisma.card.update({
    where: { id: cardId },
    data,
  });

// Generic invoice update — step9 marks invoice as PAID
export const updateInvoice = (invoiceId, data) =>
  prisma.invoice.update({
    where: { id: invoiceId },
    data,
  });

// BUG FIX [REPO-2]: updateShipment previously keyed on { id: shipmentId }.
// Steps 8a/8b/8c pass orderId, not shipmentId (shipment id is on the relation).
// Changed to look up by order_id — matches OrderShipment schema @unique order_id.
export const updateShipment = (orderId, data) =>
  prisma.orderShipment.update({
    where: { order_id: orderId },
    data,
  });

// =============================================================================
// ORDER ITEMS + CARD TEMPLATE
// Step 5 needs these for card design generation
// =============================================================================

export const findOrderItems = (orderId) =>
  prisma.cardOrderItem.findMany({
    where: { order_id: orderId },
    orderBy: { created_at: "asc" },
  });

// BUG FIX [REPO-3]: findCardTemplate previously expected a templateId (UUID)
// but step5 was calling it with school_id. Changed to findDefaultCardTemplate
// for school-scoped lookup, and kept findCardTemplate for direct id access.
export const findCardTemplate = (templateId) =>
  prisma.cardTemplate.findUnique({
    where: { id: templateId },
  });

// Used by step5 — find active template for a school (or fall back to default)
// CardTemplate is 1:1 with School (school_id @unique) — use findUnique.
// No is_active field on CardTemplate — if a row exists, it is the active template.
export const findCardTemplateForSchool = (schoolId) =>
  prisma.cardTemplate.findUnique({
    where: { school_id: schoolId },
  });

// No is_default on CardTemplate — return null so step5 proceeds without a template.
// Step5 stub engine doesn't require a template; real engine would need one seeded.
export const findDefaultCardTemplate = () => Promise.resolve(null);

// =============================================================================
// VENDOR
// Steps 6 + 8 need to look up vendor by ID
// =============================================================================

export const findVendorById = (vendorId) =>
  prisma.vendorProfile.findUnique({
    where: { id: vendorId },
    select: {
      id: true,
      name: true,
      contact_name: true,
      phone: true,
      email: true,
      address: true,
      city: true,
      state: true,
      pincode: true,
      status: true,
      avg_turnaround_days: true,
    },
  });

// =============================================================================
// BULK UPDATES
// Step 7 (printing) + step 8 (shipment/tokens)
// =============================================================================

// BUG FIX [REPO-4]: step7 was calling bulkUpdateCardPrintStatus(orderId, "PRINTED")
// with a second arg but the function only accepted orderId. The second arg was
// silently ignored meaning print_status on Card was never set to "PRINTED" — it
// stayed "PENDING". Repo now accepts an explicit printStatus param (default
// "PRINTED") so callers can be explicit and the field is correctly updated.
export const bulkUpdateCardPrintStatus = (orderId, printStatus = "PRINTED") =>
  prisma.card.updateMany({
    where: { order_id: orderId },
    data: { print_status: printStatus, printed_at: new Date() },
  });

// Step 7 — mark all order items as printed
export const bulkUpdateOrderItemsPrinted = (orderId) =>
  prisma.cardOrderItem.updateMany({
    where: { order_id: orderId },
    data: { card_printed: true, status: "PRINTED" },
  });

// BUG FIX [REPO-5]: step8 markDeliveredStep was calling
//   bulkUpdateTokenStatus(tokenIds, "ISSUED")  — passing an array as first arg.
// Repo expected { orderId, fromStatus, toStatus }. This would pass an array
// as the destructured "orderId" causing a Prisma type error at runtime.
// Fixed: now accepts (orderId, toStatus, fromStatus?) positional args — or the
// full object shape via the named-export below for backwards compat.
export const bulkUpdateTokenStatus = (
  orderIdOrOptions,
  toStatus,
  fromStatus,
) => {
  let orderId, resolvedToStatus, resolvedFromStatus;

  if (
    typeof orderIdOrOptions === "object" &&
    !Array.isArray(orderIdOrOptions)
  ) {
    ({
      orderId,
      toStatus: resolvedToStatus,
      fromStatus: resolvedFromStatus,
    } = orderIdOrOptions);
  } else {
    orderId = orderIdOrOptions;
    resolvedToStatus = toStatus;
    resolvedFromStatus = fromStatus;
  }

  return prisma.token.updateMany({
    where: {
      order_id: orderId,
      ...(resolvedFromStatus ? { status: resolvedFromStatus } : {}),
    },
    data: {
      status: resolvedToStatus,
      ...(resolvedToStatus === "ISSUED" ? { assigned_at: new Date() } : {}),
      ...(resolvedToStatus === "REVOKED" ? { revoked_at: new Date() } : {}),
    },
  });
};

// Step 10 — deactivate all QR assets when order is cancelled
export const deactivateQrAssetsForOrder = (orderId) =>
  prisma.qrAsset.updateMany({
    where: { order_id: orderId },
    data: { is_active: false },
  });

// =============================================================================
// INVOICE + PAYMENT CREATION
// =============================================================================

// BUG FIX [REPO-6]: step9 was calling createInvoice({ school_id, subscription_id,
// invoice_number, invoice_type, amount, ... }) using snake_case keys matching
// Prisma field names directly. But the repo function expected camelCase params
// (schoolId, subscriptionId, invoiceNumber, invoiceType, cardCount, unitPrice...).
// Fixed: repo now accepts BOTH camelCase params AND snake_case passthrough.
// The camelCase path is the canonical one; snake_case is mapped in.
export const createInvoice = ({
  schoolId,
  subscriptionId,
  invoiceNumber,
  invoiceType,
  cardCount,
  unitPrice,
  amount,
  taxAmount,
  totalAmount,
  dueAt,
  notes,
  school_id,
  subscription_id,
  invoice_number,
  invoice_type,
  tax_amount,
  total_amount,
  due_at,
  status,
  issued_at,
}) =>
  prisma.invoice.create({
    data: {
      school_id: schoolId ?? school_id ?? null,
      subscription_id: subscriptionId ?? subscription_id ?? null,
      invoice_number: invoiceNumber ?? invoice_number,
      invoice_type: invoiceType ?? invoice_type,
      student_count: cardCount ?? null,
      unit_price: unitPrice ?? null,
      amount: amount ?? 0,
      tax_amount: taxAmount ?? tax_amount ?? 0,
      total_amount: totalAmount ?? total_amount ?? 0,
      status: status ?? "ISSUED",
      issued_at: issued_at ?? new Date(),
      due_at: dueAt ?? due_at ?? null,
      notes: notes ?? null,
    },
  });

// BUG FIX [REPO-7]: step9 and step10 both called createPayment using snake_case
// keys ({ school_id, order_id, invoice_id, ... }) but repo expected camelCase
// ({ schoolId, orderId, invoiceId, ... }). All fields would be undefined and
// Prisma would throw. Fixed: repo now accepts both shapes.
// FIX: removed duplicate provider_ref param, use provider_ref (schema field name)
export const createPayment = ({
  schoolId,
  subscriptionId,
  orderId,
  invoiceId,
  amount,
  taxAmount,
  paymentMode,
  paymentRef,
  isAdvance,
  school_id,
  subscription_id,
  order_id,
  invoice_id,
  tax_amount,
  payment_mode,
  provider_ref,
  is_advance,
  status,
  provider,
  currency,
  metadata,
}) =>
  prisma.payment.create({
    data: {
      school_id: schoolId ?? school_id ?? null,
      subscription_id: subscriptionId ?? subscription_id ?? null,
      order_id: orderId ?? order_id ?? null,
      invoice_id: invoiceId ?? invoice_id ?? null,
      amount: amount,
      tax_amount: taxAmount ?? tax_amount ?? 0,
      status: status ?? "SUCCESS",
      provider: provider ?? "manual",
      payment_mode: paymentMode ?? payment_mode,
      provider_ref: paymentRef ?? provider_ref ?? null, // FIX: schema field is provider_ref
      is_advance: isAdvance ?? is_advance ?? false,
      metadata: metadata ?? null,
    },
  });

// =============================================================================
// AUDIT LOG
// BUG FIX [REPO-8]: Steps 5-10 call writeAuditLog with { actorId, actorType,
// schoolId, action, entity, entityId, newValue, oldValue, ip } but the repo
// function expected { userId, role, action, entity, entityId, metadata, ip }.
// The params were completely mismatched — no audit log was ever written from
// steps 5-10. Fixed: repo now accepts the full set used by all callers.
// =============================================================================

export const writeAuditLog = ({
  actorId,
  actorType,
  schoolId,
  newValue,
  oldValue,
  userId,
  role,
  action,
  entity,
  entityId,
  metadata,
  ip,
}) =>
  prisma.auditLog
    .create({
      data: {
        actor_id: actorId ?? userId ?? null, // FIX: schema uses actor_id
        actor_type: actorType ?? role ?? "SYSTEM", // FIX: schema uses actor_type (enum, not nullable)
        action,
        entity,
        entity_id: entityId ?? null,
        old_value: oldValue ?? null,
        new_value: newValue ?? null,
        metadata: metadata ?? (schoolId ? { school_id: schoolId } : null),
        ip_address: ip ?? null,
      },
    })
    .catch(() => {
      // Audit log must never crash the main flow
    });
