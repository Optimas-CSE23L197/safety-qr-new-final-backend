// =============================================================================
// order.service.js — RESQID (FIXED)
// FIXES:
//   - Paisa conversion added for payments (frontend sends rupees)
//   - Uses authoritative validateTransition from order.guards.js
//   - Removed dependency on order.helpers.js transitions
// =============================================================================

import * as repo from './order.repository.js';
import { isCancellable, requiresRefund } from './order.helpers.js';
import { ApiError } from '#shared/response/ApiError.js';
import { dispatch } from '#orchestrator/notifications/notification.dispatcher.js';
import { EVENTS } from '#orchestrator/events/event.types.js';
import { prisma } from '#config/prisma.js';
import { validateTransition } from '#orchestrator/state/order.guards.js';

const getSchoolWithContacts = async schoolId => {
  return prisma.school.findUnique({
    where: { id: schoolId },
    select: { id: true, name: true, email: true, phone: true },
  });
};

const assertValidTransition = (fromStatus, toStatus) => {
  const { valid, reason } = validateTransition(fromStatus, toStatus);
  if (!valid) {
    throw ApiError.badRequest(`Invalid status transition: ${reason}`);
  }
};

// =============================================================================
// ORDER CREATION
// =============================================================================

export const createNewOrder = async data => {
  const {
    school_id,
    order_type,
    card_count,
    items,
    delivery_address,
    notes,
    userId,
    userRole,
    order_channel,
  } = data;

  if (!school_id || school_id.length !== 36) {
    throw ApiError.badRequest('Invalid school ID');
  }

  const channel = order_channel ?? (userRole === 'SUPER_ADMIN' ? 'CALL' : 'DASHBOARD');

  const subscription = await repo.findActiveSubscription(school_id);
  if (!subscription) throw ApiError.badRequest('No active subscription found for this school');

  const timestamp = Date.now();
  const random = Math.random().toString(36).slice(2, 6).toUpperCase();
  const orderNumber = `ORD-${timestamp}-${random}`;

  const order = await repo.createOrder({
    schoolId: school_id,
    subscriptionId: subscription.id,
    orderNumber,
    orderType: order_type,
    channel,
    cardCount: card_count,
    deliveryName: delivery_address?.name,
    deliveryPhone: delivery_address?.phone,
    deliveryAddress: delivery_address?.address,
    deliveryCity: delivery_address?.city,
    deliveryState: delivery_address?.state,
    deliveryPincode: delivery_address?.pincode,
    items: order_type === 'PRE_DETAILS' ? items : [],
    createdBy: userId,
    notes: notes?.slice(0, 500),
  });

  try {
    const school = await getSchoolWithContacts(school_id);
    await dispatch({
      type: EVENTS.ORDER_PLACED,
      schoolId: school_id,
      payload: { orderNumber: order.order_number, school },
      meta: { orderId: order.id },
    });
  } catch (err) {
    console.error('Failed to send ORDER_PLACED notification:', err.message);
  }

  return { order, subscription };
};

// =============================================================================
// LIST ORDERS
// =============================================================================

export const listOrders = async (filters, user) => {
  if (user.role === 'SCHOOL_ADMIN') filters.school_id = user.schoolId;
  const [orders, total] = await repo.listOrders(filters);
  return { orders, total, limit: filters.limit || 50, offset: filters.offset || 0 };
};

// =============================================================================
// ORDER DETAILS
// =============================================================================

export const getOrderDetails = async (orderId, user) => {
  const order = await repo.findOrderById(orderId, true);
  if (!order) throw ApiError.notFound('Order not found');
  if (user.role === 'SCHOOL_ADMIN' && order.school_id !== user.schoolId) {
    throw ApiError.forbidden('Access denied');
  }
  return order;
};

// =============================================================================
// ORDER STATUS
// =============================================================================

export const getOrderStatus = async orderId => {
  const order = await repo.findOrderById(orderId, true);
  if (!order) throw ApiError.notFound('Order not found');
  return {
    orderId: order.id,
    orderNumber: order.order_number,
    status: order.status,
    paymentStatus: order.payment_status,
    progress: order.pipeline?.overall_progress || 0,
    currentStep: order.pipeline?.current_step,
    isStalled: order.pipeline?.is_stalled || false,
  };
};

// =============================================================================
// CONFIRM ORDER
// =============================================================================

export const confirmOrder = async (orderId, userId, note) => {
  const order = await repo.findOrderById(orderId, true);
  if (!order) throw ApiError.notFound('Order not found');

  assertValidTransition(order.status, 'CONFIRMED');

  if (order.order_type === 'PRE_DETAILS') {
    if (!order.items || order.items.length !== order.student_count) {
      throw ApiError.badRequest(
        `PRE_DETAILS order requires exactly ${order.student_count} items. Found: ${order.items?.length ?? 0}`
      );
    }
  }

  await repo.updateOrderStatus(
    orderId,
    'CONFIRMED',
    userId,
    note?.slice(0, 500) || 'Order confirmed',
    {}
  );

  try {
    const updatedOrder = await repo.findOrderById(orderId, false);
    const school = await getSchoolWithContacts(updatedOrder.school_id);
    await dispatch({
      type: EVENTS.ORDER_CONFIRMED,
      schoolId: updatedOrder.school_id,
      payload: {
        orderNumber: updatedOrder.order_number,
        cardCount: updatedOrder.student_count,
      },
      meta: { orderId },
    });
  } catch (err) {
    console.error('Failed to send ORDER_CONFIRMED notification:', err.message);
  }

  return { orderId, status: 'CONFIRMED', orderNumber: order.order_number };
};

// =============================================================================
// INVOICE — ADVANCE (ORDER_ADVANCE)
// =============================================================================

export const generateAdvanceInvoice = async (orderId, userId) => {
  const order = await repo.findOrderById(orderId, true);
  if (!order) throw ApiError.notFound('Order not found');

  assertValidTransition(order.status, 'PAYMENT_PENDING');

  if (order.partial_invoice_id) {
    return { invoice: order.partialInvoice, amount: order.advance_amount, alreadyExisted: true };
  }

  const subscription = order.subscription;
  if (!subscription) {
    throw ApiError.badRequest('No subscription found for this order');
  }

  if (!subscription.unit_price_snapshot) {
    throw ApiError.badRequest('Subscription has no unit price configured');
  }

  if (!order.student_count || order.student_count <= 0) {
    throw ApiError.badRequest('Invalid student count for invoice generation');
  }

  const { invoice, financials } = await repo.createAdvanceInvoice({
    schoolId: order.school_id,
    subscriptionId: order.subscription_id,
    orderId,
    orderNumber: order.order_number,
    studentCount: order.student_count,
    unitPrice: subscription.unit_price_snapshot,
    advancePercent: subscription.advance_percent,
  });

  await repo.updateOrderStatus(orderId, 'PAYMENT_PENDING', userId, 'Advance invoice generated', {
    invoiceId: invoice.id,
  });

  try {
    await dispatch({
      type: EVENTS.PARTIAL_INVOICE_GENERATED,
      schoolId: order.school_id,
      payload: {
        orderNumber: order.order_number,
        amount: financials?.advanceAmount || invoice.total_amount,
        invoiceUrl: null,
      },
      meta: { orderId },
    });
  } catch (err) {
    console.error('Failed to send PARTIAL_INVOICE_GENERATED notification:', err.message);
  }

  return { invoice, amount: financials?.advanceAmount || invoice.total_amount };
};

// =============================================================================
// PAYMENT — ADVANCE
// =============================================================================

export const recordAdvancePayment = async (orderId, paymentData, userId) => {
  const order = await repo.findOrderById(orderId, true);
  if (!order) throw ApiError.notFound('Order not found');

  if (order.status !== 'PAYMENT_PENDING') {
    throw ApiError.badRequest(
      `Cannot record advance payment. Order is in ${order.status} — expected PAYMENT_PENDING`
    );
  }

  const invoice = order.partialInvoice;
  if (!invoice) {
    throw ApiError.badRequest(
      'Advance invoice not found. Generate it first via POST /orders/:id/invoice/advance'
    );
  }

  if (invoice.status === 'PAID') {
    throw ApiError.badRequest('Advance invoice is already marked as paid');
  }

  // ✅ FIXED: Convert rupees from frontend to paisa for DB
  const amountInPaise = Math.round(paymentData.amount_received * 100);
  const expectedAmount = order.advance_amount || invoice.total_amount;

  if (amountInPaise < expectedAmount) {
    const expectedRupees = (expectedAmount / 100).toFixed(2);
    throw ApiError.badRequest(`Advance payment must be at least ₹${expectedRupees}`);
  }

  const payment = await repo.recordPayment({
    orderId,
    invoiceId: invoice.id,
    schoolId: order.school_id,
    amount: amountInPaise,
    paymentMode: paymentData.payment_mode,
    paymentRef: paymentData.payment_ref,
    userId,
  });

  await repo.updateOrderPayment(
    orderId,
    'PARTIALLY_PAID',
    userId,
    true,
    amountInPaise,
    paymentData.payment_ref
  );

  try {
    await dispatch({
      type: EVENTS.ORDER_ADVANCE_PAYMENT_RECEIVED,
      schoolId: order.school_id,
      payload: { orderNumber: order.order_number, amount: amountInPaise },
      meta: { orderId },
    });
  } catch (err) {
    console.error('Failed to send ORDER_ADVANCE_PAYMENT_RECEIVED notification:', err.message);
  }

  return {
    payment,
    invoiceId: invoice.id,
    amountReceived: amountInPaise,
    advanceAmount: expectedAmount,
  };
};

// =============================================================================
// PAYMENT — BALANCE
// =============================================================================

export const recordBalancePayment = async (orderId, paymentData, userId) => {
  const order = await repo.findOrderById(orderId, true);
  if (!order) throw ApiError.notFound('Order not found');

  if (order.status !== 'BALANCE_PENDING') {
    throw ApiError.badRequest(
      `Cannot record balance payment. Order is in ${order.status} — expected BALANCE_PENDING`
    );
  }

  // ✅ FIXED: Convert rupees from frontend to paisa for DB
  const amountInPaise = Math.round(paymentData.amount_received * 100);

  let finalInvoice = order.finalInvoice;
  if (!finalInvoice && order.final_invoice_id) {
    finalInvoice = await repo.findInvoiceById(order.final_invoice_id);
  }

  if (!finalInvoice) {
    const subscription = order.subscription;
    if (!subscription) {
      throw ApiError.badRequest('No subscription found for this order');
    }

    const balanceAmount = order.balance_amount;
    if (!balanceAmount || balanceAmount <= 0) {
      throw ApiError.badRequest('No balance amount due for this order');
    }

    const taxPercent = 18;
    const taxAmount = Math.round((balanceAmount * taxPercent) / (100 + taxPercent));
    const unitPrice = subscription.unit_price_snapshot;

    const { invoice } = await repo.createBalanceInvoice({
      schoolId: order.school_id,
      subscriptionId: order.subscription_id,
      orderId,
      orderNumber: order.order_number,
      cardCount: order.student_count,
      unitPrice: unitPrice,
      balanceAmount: balanceAmount,
      taxAmount: taxAmount,
    });
    finalInvoice = invoice;
  }

  if (finalInvoice.status === 'PAID') {
    throw ApiError.badRequest('Balance invoice is already marked as paid');
  }

  const payment = await repo.recordPayment({
    orderId,
    invoiceId: finalInvoice.id,
    schoolId: order.school_id,
    amount: amountInPaise,
    paymentMode: paymentData.payment_mode,
    paymentRef: paymentData.payment_ref,
    userId,
  });

  await repo.updateOrderPayment(
    orderId,
    'FULLY_PAID',
    userId,
    false,
    amountInPaise,
    paymentData.payment_ref
  );

  if (order.subscription_id) await repo.markSubscriptionPaid(order.subscription_id);

  try {
    await dispatch({
      type: EVENTS.ORDER_COMPLETED,
      schoolId: order.school_id,
      payload: { orderNumber: order.order_number },
      meta: { orderId },
    });
  } catch (err) {
    console.error('Failed to send ORDER_COMPLETED notification:', err.message);
  }

  return {
    payment,
    invoiceId: finalInvoice.id,
    amountReceived: amountInPaise,
    orderId,
    status: 'COMPLETED',
  };
};

// =============================================================================
// VENDOR & PRINTING
// =============================================================================

export const assignVendorToOrder = async (orderId, vendorId, userId, notes) => {
  const order = await repo.findOrderById(orderId, true);
  if (!order) throw ApiError.notFound('Order not found');

  assertValidTransition(order.status, 'SENT_TO_VENDOR');

  const updated = await repo.assignVendor(orderId, vendorId, userId, notes?.slice(0, 500));

  try {
    const fullOrder = await repo.findOrderById(orderId, true);
    await dispatch({
      type: EVENTS.ORDER_CARD_DESIGN_COMPLETE,
      schoolId: fullOrder.school_id,
      payload: { orderNumber: fullOrder.order_number, reviewUrl: null },
      meta: { orderId },
    });
  } catch (err) {
    console.error('Failed to send vendor assigned notification:', err.message);
  }

  return updated;
};

export const updatePrinting = async (orderId, status, userId, note) => {
  const order = await repo.findOrderById(orderId, true);
  if (!order) throw ApiError.notFound('Order not found');

  if (status === 'STARTED') assertValidTransition(order.status, 'PRINTING');
  else if (status === 'COMPLETED') assertValidTransition(order.status, 'PRINT_COMPLETE');

  return repo.updatePrintingStatus(orderId, status, userId, note?.slice(0, 500));
};

// =============================================================================
// SHIPMENT
// =============================================================================

export const createShipmentForOrder = async (orderId, shipmentData, userId) => {
  const order = await repo.findOrderById(orderId, true);
  if (!order) throw ApiError.notFound('Order not found');

  assertValidTransition(order.status, 'READY_TO_SHIP');

  const shipment = await repo.createShipment({
    orderId,
    awbCode: shipmentData.awb_code,
    courierName: shipmentData.courier_name,
    trackingUrl: shipmentData.tracking_url,
    vendor: order.vendor,
    deliveryAddress: {
      name: order.delivery_name,
      phone: order.delivery_phone,
      address: order.delivery_address,
      city: order.delivery_city,
      state: order.delivery_state,
      pincode: order.delivery_pincode,
    },
    userId,
    notes: shipmentData.notes?.slice(0, 500),
  });

  await repo.updateOrderStatus(orderId, 'READY_TO_SHIP', userId, 'Shipment created');
  return shipment;
};

export const markShipmentShipped = async (orderId, userId, note) => {
  const order = await repo.findOrderById(orderId, true);
  if (!order) throw ApiError.notFound('Order not found');

  assertValidTransition(order.status, 'SHIPPED');
  await repo.markShipmentShipped(orderId, userId, note?.slice(0, 500));

  try {
    const fullOrder = await repo.findOrderById(orderId, true);
    await dispatch({
      type: EVENTS.ORDER_SHIPPED,
      schoolId: fullOrder.school_id,
      payload: {
        orderNumber: fullOrder.order_number,
        trackingId: fullOrder.shipment?.awb_code,
        trackingUrl: fullOrder.shipment?.tracking_url,
        schoolPhone: fullOrder.school?.phone,
      },
      meta: { orderId },
    });
  } catch (err) {
    console.error('Failed to send ORDER_SHIPPED notification:', err.message);
  }

  return { orderId, status: 'SHIPPED' };
};

// =============================================================================
// DELIVERY
// =============================================================================

export const confirmDelivery = async (orderId, userId, note) => {
  const order = await repo.findOrderById(orderId, true);
  if (!order) throw ApiError.notFound('Order not found');

  assertValidTransition(order.status, 'DELIVERED');

  const { order: updatedOrder, balanceInvoice } = await repo.confirmDelivery(
    orderId,
    userId,
    note?.slice(0, 500)
  );

  try {
    await dispatch({
      type: EVENTS.ORDER_DELIVERED,
      schoolId: order.school_id,
      payload: { orderNumber: order.order_number },
      meta: { orderId },
    });
  } catch (err) {
    console.error('Failed to send ORDER_DELIVERED notification:', err.message);
  }

  if (balanceInvoice) {
    try {
      const school = await getSchoolWithContacts(order.school_id);
      await dispatch({
        type: EVENTS.ORDER_BALANCE_INVOICE_ISSUED,
        schoolId: order.school_id,
        payload: {
          orderNumber: order.order_number,
          amount: balanceInvoice.total_amount,
          dueDate: balanceInvoice.due_at,
          invoiceUrl: null,
          schoolPhone: school?.phone,
        },
        meta: { orderId },
      });
    } catch (err) {
      console.error('Failed to send ORDER_BALANCE_INVOICE_ISSUED notification:', err.message);
    }
  }

  return {
    orderId,
    status: 'BALANCE_PENDING',
    balanceInvoice: balanceInvoice
      ? {
          id: balanceInvoice.id,
          invoiceNumber: balanceInvoice.invoice_number,
          totalAmount: balanceInvoice.total_amount,
          dueAt: balanceInvoice.due_at,
        }
      : null,
  };
};

// =============================================================================
// INVOICE — GET
// =============================================================================

export const getInvoiceForDownload = async invoiceId => {
  const invoice = await repo.findInvoiceById(invoiceId);
  if (!invoice) throw ApiError.notFound('Invoice not found');
  return invoice;
};

export const getOrderInvoice = async (orderId, type) => {
  const typeMap = { ADVANCE: 'ORDER_ADVANCE', BALANCE: 'ORDER_FINAL' };
  const mappedType = typeMap[type];
  if (!mappedType) throw ApiError.badRequest('Invoice type must be ADVANCE or BALANCE');
  const invoice = await repo.findInvoiceByOrderAndType(orderId, mappedType);
  if (!invoice) throw ApiError.notFound(`${type} invoice not found for this order`);
  return invoice;
};

// =============================================================================
// CANCELLATION
// =============================================================================

export const cancelOrder = async (orderId, userId, reason, notes) => {
  const order = await repo.findOrderById(orderId, true);
  if (!order) throw ApiError.notFound('Order not found');

  if (!isCancellable(order.status)) {
    throw ApiError.badRequest(`Order cannot be cancelled at this stage (${order.status})`);
  }

  if (order.payment_status !== 'UNPAID' && requiresRefund(order.status)) {
    throw ApiError.badRequest(
      'Order has advance payment recorded. A refund must be processed — contact support.'
    );
  }

  await repo.cancelOrder(
    orderId,
    userId,
    reason?.slice(0, 500) || notes?.slice(0, 500) || 'Cancelled by admin'
  );

  try {
    await dispatch({
      type: EVENTS.ORDER_REFUNDED,
      schoolId: order.school_id,
      payload: { orderNumber: order.order_number, amount: 0 },
      meta: { orderId },
    });
  } catch (err) {
    console.error('Failed to send ORDER_CANCELLED notification:', err.message);
  }

  return { orderId, status: 'CANCELLED', requiresRefund: requiresRefund(order.status) };
};
