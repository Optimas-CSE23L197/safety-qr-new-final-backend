// =============================================================================
// order.service.js — RESQID
// PATCH 04: Fixed:
//   - EVENTS + notificationService import (were missing — runtime crash)
//   - channel mapping MANUAL → CALL (not in OrderChannel enum)
//   - amount validation logic (redundant double condition)
//   - invoice type lookup ADVANCE/BALANCE → PARTIAL/FINAL
//   - card_count → student_count field reference
// =============================================================================

import * as repo from './order.repository.js';
import {
  calculateOrderFinancials,
  assertValidTransition,
  isCancellable,
  requiresRefund,
} from './order.helpers.js';
import { ApiError } from '#shared/response/ApiError.js';
// FIXED: import dispatch AND EVENTS (both were missing)
import { dispatch } from '#orchestrator/notifications/notification.dispatcher.js';
import { EVENTS } from '#orchestrator/events/event.types.js';
import { prisma } from '#config/prisma.js';

const getSchoolWithContacts = async schoolId => {
  return prisma.school.findUnique({
    where: { id: schoolId },
    select: { id: true, name: true, email: true, phone: true },
  });
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

  // FIXED: OrderChannel enum is DASHBOARD | CALL. 'MANUAL' doesn't exist.
  // Channel should come from request body; default DASHBOARD for school admin
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

  // FIXED: use dispatch() with EVENTS — notificationService was never imported
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
// CONFIRM ORDER
// =============================================================================

export const confirmOrder = async (orderId, userId, note) => {
  const order = await repo.findOrderById(orderId, true);
  if (!order) throw ApiError.notFound('Order not found');

  assertValidTransition(order.status, 'CONFIRMED');

  if (order.order_type === 'PRE_DETAILS') {
    // FIXED: student_count not card_count
    if (!order.items || order.items.length !== order.student_count) {
      throw ApiError.badRequest(
        `PRE_DETAILS order requires exactly ${order.student_count} items. Found: ${order.items?.length ?? 0}`
      );
    }
  }

  const financials = calculateOrderFinancials(
    order.subscription?.pricing_tier || 'PRIVATE_STANDARD',
    order.student_count
  );

  await repo.updateOrderStatus(
    orderId,
    'CONFIRMED',
    userId,
    note?.slice(0, 500) || 'Order confirmed',
    { financials }
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
        amount: financials.grandTotal,
      },
      meta: { orderId },
    });
  } catch (err) {
    console.error('Failed to send ORDER_CONFIRMED notification:', err.message);
  }

  return { orderId, status: 'CONFIRMED', financials };
};

// =============================================================================
// INVOICE — ADVANCE (PARTIAL)
// =============================================================================

export const generateAdvanceInvoice = async (orderId, userId) => {
  const order = await repo.findOrderById(orderId, true);
  if (!order) throw ApiError.notFound('Order not found');

  assertValidTransition(order.status, 'PAYMENT_PENDING');

  // FIXED: relation is partialInvoice not advanceInvoice
  if (order.partial_invoice_id) {
    return { invoice: order.partialInvoice, amount: order.advance_amount, alreadyExisted: true };
  }

  const { invoice, financials } = await repo.createAdvanceInvoice({
    schoolId: order.school_id,
    subscriptionId: order.subscription_id,
    orderId,
    orderNumber: order.order_number,
    cardCount: order.student_count,
    pricingTier: order.subscription?.pricing_tier || 'PRIVATE_STANDARD',
    customUnitPrice: null,
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
        amount: financials.advanceAmount,
        invoiceUrl: null,
      },
      meta: { orderId },
    });
  } catch (err) {
    console.error('Failed to send PARTIAL_INVOICE_GENERATED notification:', err.message);
  }

  return { invoice, amount: financials.advanceAmount };
};

// =============================================================================
// PAYMENT — ADVANCE
// =============================================================================

export const recordAdvancePayment = async (orderId, paymentData, userId) => {
  const order = await repo.findOrderById(orderId, true);
  if (!order) throw ApiError.notFound('Order not found');

  assertValidTransition(order.status, 'ADVANCE_RECEIVED');

  if (order.status !== 'PAYMENT_PENDING') {
    throw ApiError.badRequest(
      `Cannot record advance payment. Order is in ${order.status} — expected PAYMENT_PENDING`
    );
  }

  // FIXED: relation is partialInvoice
  const invoice = order.partialInvoice;
  if (!invoice) {
    throw ApiError.badRequest(
      'Advance invoice not found. Generate it first via POST /orders/:id/invoice/advance'
    );
  }

  if (invoice.status === 'PAID') {
    throw ApiError.badRequest('Advance invoice is already marked as paid');
  }

  const expectedAmount = order.advance_amount || invoice.total_amount;

  // FIXED: simplified — was `a < b && a !== b` which is just `a < b`
  if (paymentData.amount_received < expectedAmount) {
    throw ApiError.badRequest(
      `Advance payment must be at least ₹${(expectedAmount / 100).toFixed(2)}`
    );
  }

  const payment = await repo.recordPayment({
    orderId,
    invoiceId: invoice.id,
    schoolId: order.school_id,
    amount: paymentData.amount_received,
    paymentMode: paymentData.payment_mode,
    paymentRef: paymentData.payment_ref,
    isAdvance: true,
    userId,
  });

  await repo.updateOrderPayment(
    orderId,
    'PARTIALLY_PAID',
    userId,
    true,
    paymentData.amount_received,
    paymentData.payment_ref
  );

  try {
    await dispatch({
      type: EVENTS.ORDER_ADVANCE_PAYMENT_RECEIVED,
      schoolId: order.school_id,
      payload: { orderNumber: order.order_number, amount: paymentData.amount_received },
      meta: { orderId },
    });
  } catch (err) {
    console.error('Failed to send ORDER_ADVANCE_PAYMENT_RECEIVED notification:', err.message);
  }

  return {
    payment,
    invoiceId: invoice.id,
    amountReceived: paymentData.amount_received,
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

  // FIXED: relation is finalInvoice
  let finalInvoice = order.finalInvoice;
  if (!finalInvoice && order.final_invoice_id) {
    finalInvoice = await repo.findInvoiceById(order.final_invoice_id);
  }

  if (!finalInvoice) {
    const financials = calculateOrderFinancials(
      order.subscription?.pricing_tier || 'PRIVATE_STANDARD',
      order.student_count
    );
    const { invoice } = await repo.createBalanceInvoice({
      schoolId: order.school_id,
      subscriptionId: order.subscription_id,
      orderId,
      orderNumber: order.order_number,
      cardCount: order.student_count,
      unitPrice: financials.unitPrice,
      balanceAmount: financials.balanceAmount,
      taxAmount: financials.taxAmount,
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
    amount: paymentData.amount_received,
    paymentMode: paymentData.payment_mode,
    paymentRef: paymentData.payment_ref,
    isAdvance: false,
    userId,
  });

  await repo.updateOrderPayment(
    orderId,
    'FULLY_PAID',
    userId,
    false,
    paymentData.amount_received,
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
    amountReceived: paymentData.amount_received,
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

  assertValidTransition(order.status, 'VENDOR_SENT');

  const updated = await repo.assignVendor(orderId, vendorId, userId, notes?.slice(0, 500));

  try {
    const fullOrder = await repo.findOrderById(orderId, true);
    await dispatch({
      type: EVENTS.ORDER_CARD_DESIGN_COMPLETE, // closest event for vendor dispatch
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

  assertValidTransition(order.status, 'BALANCE_PENDING');

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
    balanceInvoice: {
      id: balanceInvoice.id,
      invoiceNumber: balanceInvoice.invoice_number,
      totalAmount: balanceInvoice.total_amount,
      dueAt: balanceInvoice.due_at,
    },
  };
};

// =============================================================================
// INVOICE — GET
// FIXED: type mapping ADVANCE→PARTIAL, BALANCE→FINAL
// =============================================================================

export const getInvoiceForDownload = async invoiceId => {
  const invoice = await repo.findInvoiceById(invoiceId);
  if (!invoice) throw ApiError.notFound('Invoice not found');
  return invoice;
};

export const getOrderInvoice = async (orderId, type) => {
  // Route sends 'ADVANCE' or 'BALANCE' — map to schema enum values
  const typeMap = { ADVANCE: 'PARTIAL', BALANCE: 'FINAL' };
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
