// =============================================================================
// order.repository.js — RESQID (FULLY FIXED)
// FIXES:
//   - order_invoice_type → invoice_type
//   - PARTIAL/FINAL → ORDER_ADVANCE/ORDER_FINAL
//   - pricing_tier → plan
//   - unit_price → unit_price_snapshot
//   - Removed is_advance from payment
//   - Removed category from invoice
// =============================================================================

import { prisma } from '#config/prisma.js';
import { encryptField, decryptField } from '#shared/security/encryption.js';
import { calculateBalanceDueDate } from './order.helpers.js';

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
    where: { school_id: schoolId, status: { in: ['ACTIVE', 'TRIALING'] } },
    orderBy: { created_at: 'desc' },
    select: {
      id: true,
      plan: true,
      unit_price_snapshot: true,
      renewal_price_snapshot: true,
      advance_percent: true,
      is_pilot: true,
      student_count: true,
      active_card_count: true,
      status: true,
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
    partialInvoice: true,
    finalInvoice: true,
    ...(includeDetails
      ? {
          items: { orderBy: { created_at: 'asc' }, take: 100 },
          school: { select: { id: true, name: true, code: true } },
          subscription: {
            select: {
              id: true,
              plan: true,
              unit_price_snapshot: true,
              renewal_price_snapshot: true,
              advance_percent: true,
              is_pilot: true,
              status: true,
            },
          },
          shipment: true,
          statusLogs: { orderBy: { created_at: 'desc' }, take: 20 },
          vendor: { select: { id: true, name: true } },
          pipeline: { select: { current_step: true, overall_progress: true, is_stalled: true } },
        }
      : {}),
  };

  const order = await prisma.cardOrder.findUnique({ where: { id: orderId }, include });
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
        student_count: true,
        status: true,
        payment_status: true,
        created_at: true,
        school: { select: { id: true, name: true, code: true } },
        pipeline: { select: { current_step: true, overall_progress: true, is_stalled: true } },
        partialInvoice: { select: { id: true, status: true, total_amount: true } },
        finalInvoice: { select: { id: true, status: true, total_amount: true } },
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
// ORDER — CREATE
// =============================================================================

export const createOrder = async data => {
  const {
    schoolId,
    subscriptionId,
    orderNumber,
    orderType,
    channel,
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
    const order = await tx.cardOrder.create({
      data: {
        school_id: schoolId,
        subscription_id: subscriptionId || null,
        order_number: orderNumber,
        order_type: orderType,
        order_channel: channel,
        student_count: cardCount,
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
        actor_type: 'SUPER_ADMIN',
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
      data: { status: newStatus, status_changed_by: userId, status_changed_at: new Date() },
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
        actor_type: 'SUPER_ADMIN',
      },
    });

    return updated;
  });
};

// =============================================================================
// INVOICE — ADVANCE (ORDER_ADVANCE)
// =============================================================================

export const createAdvanceInvoice = async data => {
  const {
    schoolId,
    subscriptionId,
    orderId,
    orderNumber,
    studentCount,
    unitPrice,
    advancePercent,
  } = data;

  const subtotal = unitPrice * studentCount;
  const taxPercent = 18;
  const taxAmount = Math.round((subtotal * taxPercent) / 100);
  const totalAmount = subtotal + taxAmount;
  const advanceAmount = Math.round((totalAmount * advancePercent) / 100);

  const invoiceNumber = `INV-ADV-${orderNumber || orderId.slice(0, 8)}-${Date.now()}`;

  return prisma.$transaction(async tx => {
    const existing = await tx.invoice.findFirst({
      where: {
        order_id: orderId,
        invoice_type: 'ORDER_ADVANCE',
      },
      select: { id: true, total_amount: true },
    });

    if (existing) {
      return { invoice: existing, financials: null, alreadyExisted: true };
    }

    const invoice = await tx.invoice.create({
      data: {
        school_id: schoolId,
        subscription_id: subscriptionId || null,
        order_id: orderId,
        invoice_number: invoiceNumber,
        invoice_type: 'ORDER_ADVANCE',
        student_count: studentCount,
        unit_price: unitPrice,
        amount: subtotal,
        tax_percent: taxPercent,
        tax_amount: taxAmount,
        total_amount: advanceAmount,
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
        partial_invoice_id: invoice.id,
        advance_amount: advanceAmount,
        grand_total: totalAmount,
        balance_amount: totalAmount - advanceAmount,
        unit_price: unitPrice,
      },
    });

    return {
      invoice,
      financials: {
        subtotal,
        taxAmount,
        totalAmount,
        advanceAmount,
        unitPrice,
      },
      alreadyExisted: false,
    };
  });
};

// =============================================================================
// INVOICE — FINAL (ORDER_FINAL)
// =============================================================================

export const createBalanceInvoice = async data => {
  const {
    schoolId,
    subscriptionId,
    orderId,
    cardCount,
    unitPrice,
    balanceAmount,
    taxAmount,
    orderNumber,
  } = data;

  const invoiceNumber = `INV-FNL-${orderNumber || orderId.slice(0, 8)}-${Date.now()}`;

  return prisma.$transaction(async tx => {
    const existing = await tx.invoice.findFirst({
      where: { order_id: orderId, invoice_type: 'ORDER_FINAL' },
      select: { id: true, total_amount: true },
    });
    if (existing) return { invoice: existing, alreadyExisted: true };

    const invoice = await tx.invoice.create({
      data: {
        school_id: schoolId,
        subscription_id: subscriptionId || null,
        order_id: orderId,
        invoice_number: invoiceNumber,
        invoice_type: 'ORDER_FINAL',
        student_count: cardCount,
        unit_price: unitPrice,
        amount: balanceAmount - taxAmount,
        tax_percent: 18,
        tax_amount: taxAmount,
        total_amount: balanceAmount,
        status: 'ISSUED',
        issued_at: new Date(),
        due_at: calculateBalanceDueDate(),
      },
      select: { id: true, invoice_number: true, total_amount: true, due_at: true },
    });

    await tx.cardOrder.update({
      where: { id: orderId },
      data: {
        final_invoice_id: invoice.id,
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
  const { orderId, invoiceId, schoolId, amount, paymentMode, paymentRef, userId } = data;

  return prisma.$transaction(async tx => {
    if (paymentRef) {
      const existing = await tx.payment.findUnique({
        where: { payment_ref: paymentRef },
        select: { id: true },
      });
      if (existing) throw new Error('Duplicate payment reference');
    }

    const payment = await tx.payment.create({
      data: {
        school_id: schoolId,
        order_id: orderId,
        invoice_id: invoiceId,
        amount,
        status: 'SUCCESS',
        payment_mode: paymentMode,
        payment_ref: paymentRef,
        recorded_by: userId,
        notes: `Payment recorded by ${userId}`,
        metadata: {
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
// ORDER PAYMENT STATUS UPDATE
// =============================================================================

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
        actor_type: 'SUPER_ADMIN',
      },
    });

    return updated;
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
        actor_type: 'SUPER_ADMIN',
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
        actor_type: 'SUPER_ADMIN',
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
      data: { status: 'SHIPPED', status_changed_by: userId, status_changed_at: new Date() },
      select: { id: true, status: true },
    });

    await tx.orderStatusLog.create({
      data: {
        order_id: orderId,
        from_status: 'READY_TO_SHIP',
        to_status: 'SHIPPED',
        changed_by: userId,
        note: note?.slice(0, 500) || 'Shipment picked up',
        actor_type: 'SUPER_ADMIN',
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
        subscription: { select: { plan: true, unit_price_snapshot: true } },
        school: { select: { id: true } },
      },
    });
    if (!order) throw new Error('Order not found');

    await tx.orderShipment.updateMany({
      where: { order_id: orderId },
      data: { status: 'DELIVERED', delivered_at: new Date(), delivery_confirmed_by: userId },
    });

    let balanceAmount, unitPrice, taxAmount;
    if (order.balance_amount && order.balance_amount > 0) {
      balanceAmount = order.balance_amount;
      unitPrice = order.unit_price || 0;
      taxAmount = Math.round(balanceAmount * (18 / 118));
    } else {
      const subscription = order.subscription;
      unitPrice = subscription?.unit_price_snapshot || 19900;
      const subtotal = unitPrice * order.student_count;
      const totalAmount = subtotal + Math.round((subtotal * 18) / 100);
      const advancePercent = subscription?.advance_percent || 50;
      const advanceAmount = Math.round((totalAmount * advancePercent) / 100);
      balanceAmount = totalAmount - advanceAmount;
      taxAmount = Math.round((balanceAmount * 18) / 118);
    }

    let finalInvoice = await tx.invoice.findFirst({
      where: { order_id: orderId, invoice_type: 'ORDER_FINAL' },
      select: { id: true, invoice_number: true, total_amount: true, due_at: true },
    });

    if (!finalInvoice && balanceAmount > 0) {
      const invoiceNumber = `INV-FNL-${orderId.slice(0, 8)}-${Date.now()}`;

      finalInvoice = await tx.invoice.create({
        data: {
          school_id: order.school_id,
          subscription_id: order.subscription_id || null,
          order_id: orderId,
          invoice_number: invoiceNumber,
          invoice_type: 'ORDER_FINAL',
          student_count: order.student_count,
          unit_price: unitPrice,
          amount: balanceAmount - taxAmount,
          tax_percent: 18,
          tax_amount: taxAmount,
          total_amount: balanceAmount,
          status: 'ISSUED',
          issued_at: new Date(),
          due_at: calculateBalanceDueDate(),
        },
        select: { id: true, invoice_number: true, total_amount: true, due_at: true },
      });

      await tx.cardOrder.update({
        where: { id: orderId },
        data: {
          final_invoice_id: finalInvoice.id,
          balance_amount: balanceAmount,
        },
      });
    }

    const updatedOrder = await tx.cardOrder.update({
      where: { id: orderId },
      data: { status: 'BALANCE_PENDING', status_changed_by: userId, status_changed_at: new Date() },
      select: { id: true, status: true },
    });

    await tx.orderStatusLog.create({
      data: {
        order_id: orderId,
        from_status: 'SHIPPED',
        to_status: 'BALANCE_PENDING',
        changed_by: userId,
        note: note?.slice(0, 500) || 'Delivery confirmed — final invoice issued',
        metadata: { final_invoice_id: finalInvoice?.id, balance_amount: balanceAmount },
        actor_type: 'SUPER_ADMIN',
      },
    });

    return { order: updatedOrder, balanceInvoice: finalInvoice };
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
        from_status: prev?.status,
        to_status: 'CANCELLED',
        changed_by: userId,
        note: reason?.slice(0, 500),
        actor_type: 'SUPER_ADMIN',
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
          school: { select: { id: true, name: true, code: true, address: true } },
          subscription: { select: { id: true, plan: true, unit_price_snapshot: true } },
        },
      },
      payments: {
        select: {
          id: true,
          amount: true,
          payment_mode: true,
          payment_ref: true,
          created_at: true,
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
          school: { select: { id: true, name: true, code: true, address: true } },
        },
      },
      payments: {
        select: {
          id: true,
          amount: true,
          payment_mode: true,
          payment_ref: true,
        },
      },
    },
  });
};
