// =============================================================================
// order.repository.js — RESQID (FIXED — using correct field names)
// =============================================================================

import { prisma } from '#config/database/prisma.js';
import { encryptField, decryptField } from '#utils/security/encryption.js';
import { calculateOrderFinancials, calculateBalanceDueDate } from './order.helpers.js';

// =============================================================================
// HELPERS
// =============================================================================

const enc = v => (v ? encryptField(v) : null);
const dec = v => (v ? decryptField(v) : null);

const decryptOrder = order => {
  if (!order) return null;
  if (order.delivery_phone) order.delivery_phone = dec(order.delivery_phone);
  if (order.delivery_address) order.delivery_address = dec(order.delivery_address);
  return order;
};

// =============================================================================
// SUBSCRIPTION
// =============================================================================

export const findActiveSubscription = schoolId => {
  return prisma.subscription.findFirst({
    where: { school_id: schoolId, status: 'ACTIVE' },
    orderBy: { created_at: 'desc' },
    select: {
      id: true,
      pricing_tier: true,
      unit_price: true,
      grand_total: true,
      student_count: true,
    },
  });
};

export const markSubscriptionPaid = subscriptionId => {
  return prisma.subscription.update({
    where: { id: subscriptionId },
    data: { fully_paid_at: new Date() },
    select: { id: true },
  });
};

// =============================================================================
// ORDER — FETCH
// =============================================================================

export const findOrderById = async (orderId, includeDetails = true) => {
  const include = {
    // These must be included for payment to work
    advanceInvoice: true,
    balanceInvoice: true,
    ...(includeDetails
      ? {
          items: { orderBy: { created_at: 'asc' }, take: 100 },
          school: { select: { id: true, name: true, code: true } },
          subscription: {
            select: { id: true, pricing_tier: true, unit_price: true },
          },
          shipment: true,
          statusLogs: { orderBy: { created_at: 'desc' }, take: 20 },
          vendor: { select: { id: true, name: true } },
          pipeline: {
            select: {
              current_step: true,
              overall_progress: true,
              is_stalled: true,
            },
          },
        }
      : {}),
  };

  const order = await prisma.cardOrder.findUnique({
    where: { id: orderId },
    include,
  });

  // Debug: Log what was loaded
  console.log('findOrderById result:', {
    id: order?.id,
    advance_invoice_id: order?.advance_invoice_id,
    hasAdvanceInvoice: !!order?.advanceInvoice,
  });

  return decryptOrder(order);
};

// =============================================================================
// ORDER — LIST
// =============================================================================

export const listOrders = async ({
  status,
  school_id,
  from_date,
  to_date,
  limit = 50,
  offset = 0,
}) => {
  const where = {};

  if (status) where.status = status;
  if (school_id) where.school_id = school_id;
  if (from_date || to_date) {
    where.created_at = {};
    if (from_date) where.created_at.gte = new Date(from_date);
    if (to_date) where.created_at.lte = new Date(to_date);
  }

  const [orders, total] = await Promise.all([
    prisma.cardOrder.findMany({
      where,
      select: {
        id: true,
        order_number: true,
        order_type: true,
        card_count: true,
        status: true,
        payment_status: true,
        created_at: true,
        school: { select: { id: true, name: true, code: true } },
        pipeline: {
          select: {
            current_step: true,
            overall_progress: true,
            is_stalled: true,
          },
        },
        advanceInvoice: {
          select: { id: true, status: true, total_amount: true },
        },
        balanceInvoice: {
          select: { id: true, status: true, total_amount: true },
        },
      },
      orderBy: { created_at: 'desc' },
      take: Math.min(limit, 100),
      skip: offset,
    }),
    prisma.cardOrder.count({ where }),
  ]);

  return [orders, total];
};

// =============================================================================
// ORDER — CREATE (FIXED — using correct field names)
// =============================================================================

export const createOrder = async data => {
  const {
    schoolId,
    subscriptionId,
    orderNumber,
    orderType,
    channel, // This is actually order_channel in schema
    cardCount,
    deliveryName,
    deliveryPhone,
    deliveryAddress,
    deliveryCity,
    deliveryState,
    deliveryPincode,
    items = [],
    createdBy,
    notes,
  } = data;

  return prisma.$transaction(async tx => {
    // ✅ FIXED: Use correct field names from schema
    const order = await tx.cardOrder.create({
      data: {
        school_id: schoolId,
        subscription_id: subscriptionId || null,
        order_number: orderNumber,
        order_type: orderType,
        // order_channel is the correct field name, not 'channel'
        order_channel: channel, // ← FIXED: order_channel not channel
        card_count: cardCount,
        status: 'PENDING',
        payment_status: 'UNPAID',
        delivery_name: deliveryName || null,
        delivery_phone: enc(deliveryPhone),
        delivery_address: enc(deliveryAddress),
        delivery_city: deliveryCity || null,
        delivery_state: deliveryState || null,
        delivery_pincode: deliveryPincode || null,
        notes: notes || null,
      },
      select: { id: true, order_number: true, status: true },
    });

    await tx.orderStatusLog.create({
      data: {
        order_id: order.id,
        from_status: null,
        to_status: 'PENDING',
        changed_by: createdBy,
        note: `Order created via ${channel}`,
      },
    });

    if (items.length > 0) {
      const BATCH_SIZE = 500;
      for (let i = 0; i < items.length; i += BATCH_SIZE) {
        const batch = items.slice(i, i + BATCH_SIZE);
        await tx.cardOrderItem.createMany({
          data: batch.map(item => ({
            order_id: order.id,
            student_name: item.student_name.slice(0, 100),
            class: item.class?.slice(0, 50) || null,
            section: item.section?.slice(0, 50) || null,
            roll_number: item.roll_number?.slice(0, 50) || null,
            photo_url: item.photo_url || null,
            student_id: item.student_id || null,
            status: 'PENDING',
          })),
        });
      }
    }

    return order;
  });
};

// =============================================================================
// ORDER — STATUS UPDATE
// =============================================================================

export const updateOrderStatus = async (orderId, newStatus, userId, note, metadata = {}) => {
  return prisma.$transaction(async tx => {
    const prev = await tx.cardOrder.findUnique({
      where: { id: orderId },
      select: { status: true },
    });
    if (!prev) throw new Error('Order not found');

    const updated = await tx.cardOrder.update({
      where: { id: orderId },
      data: {
        status: newStatus,
        status_changed_by: userId,
        status_changed_at: new Date(),
      },
      select: { id: true, status: true },
    });

    await tx.orderStatusLog.create({
      data: {
        order_id: orderId,
        from_status: prev.status,
        to_status: newStatus,
        changed_by: userId,
        note: note?.slice(0, 500),
        metadata,
      },
    });

    return updated;
  });
};

// =============================================================================
// INVOICE — ADVANCE
// =============================================================================

export const createAdvanceInvoice = async data => {
  const { schoolId, subscriptionId, orderId, cardCount, pricingTier, customUnitPrice } = data;

  const financials = calculateOrderFinancials(pricingTier, cardCount, customUnitPrice);
  const invoiceNumber = `INV-ADV-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`;

  return prisma.$transaction(async tx => {
    const existing = await tx.invoice.findFirst({
      where: { order_id: orderId, invoice_type: 'ADVANCE' },
      select: { id: true, total_amount: true },
    });
    if (existing) {
      return { invoice: existing, financials, alreadyExisted: true };
    }

    const invoice = await tx.invoice.create({
      data: {
        school_id: schoolId,
        subscription_id: subscriptionId || null,
        order_id: orderId,
        invoice_number: invoiceNumber,
        invoice_type: 'ADVANCE',
        student_count: cardCount,
        unit_price: financials.unitPrice,
        amount: financials.subtotal,
        tax_amount: financials.taxAmount,
        total_amount: financials.advanceAmount,
        status: 'ISSUED',
        issued_at: new Date(),
        due_at: new Date(Date.now() + 7 * 24 * 60 * 60 * 1000),
      },
      select: {
        id: true,
        invoice_number: true,
        total_amount: true,
        due_at: true,
      },
    });

    await tx.cardOrder.update({
      where: { id: orderId },
      data: {
        advance_invoice_id: invoice.id,
        advance_amount: financials.advanceAmount,
        grand_total: financials.grandTotal,
        balance_amount: financials.balanceAmount,
        unit_price: financials.unitPrice,
      },
    });

    return { invoice, financials, alreadyExisted: false };
  });
};

// =============================================================================
// INVOICE — BALANCE
// =============================================================================

export const createBalanceInvoice = async data => {
  const { schoolId, subscriptionId, orderId, cardCount, unitPrice, balanceAmount, taxAmount } =
    data;

  const invoiceNumber = `INV-BAL-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`;

  return prisma.$transaction(async tx => {
    const existing = await tx.invoice.findFirst({
      where: { order_id: orderId, invoice_type: 'BALANCE' },
      select: { id: true, total_amount: true },
    });
    if (existing) return { invoice: existing, alreadyExisted: true };

    const invoice = await tx.invoice.create({
      data: {
        school_id: schoolId,
        subscription_id: subscriptionId || null,
        order_id: orderId,
        invoice_number: invoiceNumber,
        invoice_type: 'BALANCE',
        student_count: cardCount,
        unit_price: unitPrice,
        amount: balanceAmount - taxAmount,
        tax_amount: taxAmount,
        total_amount: balanceAmount,
        status: 'ISSUED',
        issued_at: new Date(),
        due_at: calculateBalanceDueDate(),
      },
      select: {
        id: true,
        invoice_number: true,
        total_amount: true,
        due_at: true,
      },
    });

    await tx.cardOrder.update({
      where: { id: orderId },
      data: {
        balance_invoice_id: invoice.id,
        balance_amount: balanceAmount,
      },
    });

    return { invoice, alreadyExisted: false };
  });
};

// =============================================================================
// PAYMENT — RECORD
// =============================================================================

export const recordPayment = async data => {
  const {
    orderId,
    invoiceId,
    schoolId,
    subscriptionId,
    amount,
    paymentMode,
    paymentRef,
    isAdvance,
    userId,
  } = data;

  return prisma.$transaction(async tx => {
    if (paymentRef) {
      const existing = await tx.payment.findUnique({
        where: { provider_ref: paymentRef },
        select: { id: true },
      });
      if (existing) throw new Error('Duplicate payment reference');
    }

    const payment = await tx.payment.create({
      data: {
        school_id: schoolId,
        subscription_id: subscriptionId || null,
        order_id: orderId,
        invoice_id: invoiceId,
        amount,
        status: 'SUCCESS',
        provider: 'manual',
        payment_mode: paymentMode,
        provider_ref: paymentRef,
        is_advance: isAdvance,
        metadata: {
          recorded_by: userId,
          recorded_at: new Date().toISOString(),
        },
      },
      select: { id: true, amount: true, created_at: true },
    });

    await tx.invoice.update({
      where: { id: invoiceId },
      data: { status: 'PAID', paid_at: new Date() },
    });

    return payment;
  });
};

// =============================================================================
// VENDOR & PRINTING
// =============================================================================

export const assignVendor = async (orderId, vendorId, userId, notes) => {
  return prisma.$transaction(async tx => {
    const vendor = await tx.vendorProfile.findUnique({
      where: { id: vendorId },
      select: { id: true, name: true },
    });
    if (!vendor) throw new Error('Vendor not found');

    const updated = await tx.cardOrder.update({
      where: { id: orderId },
      data: {
        vendor_id: vendorId,
        vendor_notes: notes?.slice(0, 500) || null,
        files_sent_to_vendor_at: new Date(),
        files_sent_by: userId,
        status: 'SENT_TO_VENDOR',
        status_changed_by: userId,
        status_changed_at: new Date(),
      },
      select: { id: true, status: true },
    });

    await tx.orderStatusLog.create({
      data: {
        order_id: orderId,
        from_status: 'CARD_DESIGN_READY',
        to_status: 'SENT_TO_VENDOR',
        changed_by: userId,
        note: `Assigned to vendor: ${vendor.name}`,
        metadata: { vendor_id: vendorId },
      },
    });

    return updated;
  });
};

export const updatePrintingStatus = async (orderId, status, userId, note) => {
  const newStatus = status === 'STARTED' ? 'PRINTING' : 'PRINT_COMPLETE';
  const updateData = {
    status: newStatus,
    status_changed_by: userId,
    status_changed_at: new Date(),
    ...(status === 'COMPLETED' ? { print_complete_at: new Date() } : {}),
  };

  return prisma.$transaction(async tx => {
    const prev = await tx.cardOrder.findUnique({
      where: { id: orderId },
      select: { status: true },
    });

    const updated = await tx.cardOrder.update({
      where: { id: orderId },
      data: updateData,
      select: { id: true, status: true },
    });

    await tx.orderStatusLog.create({
      data: {
        order_id: orderId,
        from_status: prev.status,
        to_status: newStatus,
        changed_by: userId,
        note: note?.slice(0, 500) || `Printing ${status.toLowerCase()}`,
        metadata: { printing_status: status },
      },
    });

    return updated;
  });
};

// =============================================================================
// SHIPMENT
// =============================================================================

export const createShipment = async ({
  orderId,
  awbCode,
  courierName,
  trackingUrl,
  vendor,
  deliveryAddress,
  userId,
  notes,
}) => {
  return prisma.orderShipment.create({
    data: {
      order_id: orderId,
      awb_code: awbCode?.slice(0, 100),
      courier_name: courierName?.slice(0, 100),
      tracking_url: trackingUrl || null,
      created_by: userId,
      pickup_vendor_id: vendor?.id || null,
      pickup_name: vendor?.name || null,
      delivery_name: deliveryAddress?.name?.slice(0, 100),
      delivery_phone: enc(deliveryAddress?.phone),
      delivery_address: enc(deliveryAddress?.address),
      delivery_city: deliveryAddress?.city?.slice(0, 100),
      delivery_state: deliveryAddress?.state?.slice(0, 100),
      delivery_pincode: deliveryAddress?.pincode?.slice(0, 6),
      notes: notes?.slice(0, 500) || null,
    },
    select: { id: true, awb_code: true, tracking_url: true, status: true },
  });
};

export const markShipmentShipped = async (orderId, userId, note) => {
  return prisma.$transaction(async tx => {
    await tx.orderShipment.updateMany({
      where: { order_id: orderId },
      data: { status: 'PICKED_UP', picked_up_at: new Date() },
    });

    const updated = await tx.cardOrder.update({
      where: { id: orderId },
      data: {
        status: 'SHIPPED',
        status_changed_by: userId,
        status_changed_at: new Date(),
      },
      select: { id: true, status: true },
    });

    await tx.orderStatusLog.create({
      data: {
        order_id: orderId,
        from_status: 'READY_TO_SHIP',
        to_status: 'SHIPPED',
        changed_by: userId,
        note: note?.slice(0, 500) || 'Shipment picked up',
      },
    });

    return updated;
  });
};

// =============================================================================
// DELIVERY — CONFIRM
// =============================================================================

export const confirmDelivery = async (orderId, userId, note) => {
  return prisma.$transaction(async tx => {
    const order = await tx.cardOrder.findUnique({
      where: { id: orderId },
      include: {
        subscription: { select: { pricing_tier: true } },
        school: { select: { id: true } },
      },
    });
    if (!order) throw new Error('Order not found');

    await tx.orderShipment.updateMany({
      where: { order_id: orderId },
      data: {
        status: 'DELIVERED',
        delivered_at: new Date(),
        delivery_confirmed_by: userId,
      },
    });

    let balanceAmount, unitPrice, taxAmount;

    if (order.balance_amount && order.balance_amount > 0) {
      balanceAmount = order.balance_amount;
      unitPrice = order.unit_price || 0;
      taxAmount = Math.round(balanceAmount * (18 / 118));
    } else {
      const financials = calculateOrderFinancials(
        order.subscription?.pricing_tier || 'PRIVATE_STANDARD',
        order.card_count
      );
      balanceAmount = financials.balanceAmount;
      unitPrice = financials.unitPrice;
      taxAmount = financials.taxAmount;
    }

    const balanceDueAt = calculateBalanceDueDate();

    let balanceInvoice = await tx.invoice.findFirst({
      where: { order_id: orderId, invoice_type: 'BALANCE' },
      select: {
        id: true,
        invoice_number: true,
        total_amount: true,
        due_at: true,
      },
    });

    if (!balanceInvoice) {
      const invoiceNumber = `INV-BAL-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`;

      balanceInvoice = await tx.invoice.create({
        data: {
          school_id: order.school_id,
          subscription_id: order.subscription_id || null,
          order_id: orderId,
          invoice_number: invoiceNumber,
          invoice_type: 'BALANCE',
          student_count: order.card_count,
          unit_price: unitPrice,
          amount: balanceAmount - taxAmount,
          tax_amount: taxAmount,
          total_amount: balanceAmount,
          status: 'ISSUED',
          issued_at: new Date(),
          due_at: balanceDueAt,
        },
        select: {
          id: true,
          invoice_number: true,
          total_amount: true,
          due_at: true,
        },
      });

      await tx.cardOrder.update({
        where: { id: orderId },
        data: {
          balance_invoice_id: balanceInvoice.id,
          balance_amount: balanceAmount,
          balance_due_at: balanceDueAt,
        },
      });
    }

    const updatedOrder = await tx.cardOrder.update({
      where: { id: orderId },
      data: {
        status: 'BALANCE_PENDING',
        status_changed_by: userId,
        status_changed_at: new Date(),
        balance_due_at: balanceDueAt,
      },
      select: { id: true, status: true, balance_due_at: true },
    });

    await tx.orderStatusLog.create({
      data: {
        order_id: orderId,
        from_status: 'SHIPPED',
        to_status: 'BALANCE_PENDING',
        changed_by: userId,
        note: note?.slice(0, 500) || 'Delivery confirmed — balance invoice issued',
        metadata: {
          balance_invoice_id: balanceInvoice.id,
          balance_amount: balanceAmount,
        },
      },
    });

    return { order: updatedOrder, balanceInvoice };
  });
};

// =============================================================================
// CANCELLATION
// =============================================================================

export const cancelOrder = async (orderId, userId, reason) => {
  return prisma.$transaction(async tx => {
    await tx.token.updateMany({
      where: { order_id: orderId },
      data: { status: 'REVOKED', revoked_at: new Date() },
    });

    const prev = await tx.cardOrder.findUnique({
      where: { id: orderId },
      select: { status: true },
    });

    const updated = await tx.cardOrder.update({
      where: { id: orderId },
      data: {
        status: 'CANCELLED',
        status_changed_by: userId,
        status_changed_at: new Date(),
        status_note: reason?.slice(0, 500),
      },
      select: { id: true, status: true },
    });

    await tx.orderStatusLog.create({
      data: {
        order_id: orderId,
        from_status: prev?.status || 'UNKNOWN',
        to_status: 'CANCELLED',
        changed_by: userId,
        note: reason?.slice(0, 500),
      },
    });

    return updated;
  });
};

// =============================================================================
// INVOICE QUERIES
// =============================================================================

export const findInvoiceById = invoiceId => {
  return prisma.invoice.findUnique({
    where: { id: invoiceId },
    include: {
      order: {
        select: {
          order_number: true,
          school: {
            select: { id: true, name: true, code: true, address: true },
          },
          subscription: { select: { id: true, pricing_tier: true } },
        },
      },
    },
  });
};

export const findInvoiceByOrderAndType = (orderId, type) => {
  return prisma.invoice.findFirst({
    where: { order_id: orderId, invoice_type: type },
    include: {
      order: {
        select: {
          order_number: true,
          school: {
            select: { id: true, name: true, code: true, address: true },
          },
        },
      },
    },
  });
};

export const updateOrderPayment = async (
  orderId,
  paymentStatus,
  userId,
  isAdvance,
  amount,
  reference
) => {
  return prisma.$transaction(async tx => {
    const prev = await tx.cardOrder.findUnique({
      where: { id: orderId },
      select: { status: true },
    });

    const updated = await tx.cardOrder.update({
      where: { id: orderId },
      data: {
        payment_status: paymentStatus,
        status: isAdvance ? 'ADVANCE_RECEIVED' : 'COMPLETED',
        ...(isAdvance ? { advance_paid_at: new Date() } : { balance_paid_at: new Date() }),
        status_changed_by: userId,
        status_changed_at: new Date(),
      },
      select: { id: true, status: true, payment_status: true },
    });

    await tx.orderStatusLog.create({
      data: {
        order_id: orderId,
        from_status: prev.status,
        to_status: updated.status,
        changed_by: userId,
        note: amount ? `Payment ₹${(amount / 100).toFixed(2)} recorded` : 'Payment status updated',
        metadata: { reference: reference || null },
      },
    });

    return updated;
  });
};
