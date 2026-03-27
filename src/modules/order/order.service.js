// =============================================================================
// order.service.js — RESQID (Business Logic Layer with Notifications)
// =============================================================================
import * as repo from './order.repository.js';
import {
  calculateOrderFinancials,
  assertValidTransition,
  isCancellable,
  requiresRefund,
} from './order.helpers.js';
import { ApiError } from '#utils/response/ApiError.js';
import { notificationService } from '#services/communication/notification.service.js';
import { prisma } from '#config/database/prisma.js';

// =============================================================================
// HELPER — Get school with contact details for notifications
// =============================================================================

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
  const { school_id, order_type, card_count, items, delivery_address, notes, userId, userRole } =
    data;

  // Validate school_id format
  if (!school_id || school_id.length !== 36) {
    throw ApiError.badRequest('Invalid school ID');
  }

  const channel = userRole === 'SUPER_ADMIN' ? 'MANUAL' : 'DASHBOARD';

  const subscription = await repo.findActiveSubscription(school_id);
  if (!subscription) {
    throw ApiError.badRequest('No active subscription found for this school');
  }

  // Generate unique order number
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

  // ✅ NOTIFICATION: Order Created
  try {
    const school = await getSchoolWithContacts(school_id);
    await notificationService.notifyOrder('ORDER_CREATED', order, school);
  } catch (err) {
    // Non-blocking — notification failure shouldn't break order creation
    console.error('Failed to send ORDER_CREATED notification:', err.message);
  }

  return { order, subscription };
};

// =============================================================================
// LIST ORDERS (with permission filtering)
// =============================================================================

export const listOrders = async (filters, user) => {
  // Apply tenant isolation
  if (user.role === 'SCHOOL_ADMIN') {
    filters.school_id = user.schoolId;
  }

  const [orders, total] = await repo.listOrders(filters);
  return {
    orders,
    total,
    limit: filters.limit || 50,
    offset: filters.offset || 0,
  };
};

// =============================================================================
// ORDER DETAILS (with permission check)
// =============================================================================

export const getOrderDetails = async (orderId, user) => {
  const order = await repo.findOrderById(orderId, true);
  if (!order) throw ApiError.notFound('Order not found');

  // Permission check
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
    if (!order.items || order.items.length !== order.card_count) {
      throw ApiError.badRequest(
        `PRE_DETAILS order requires exactly ${order.card_count} items. Found: ${order.items?.length ?? 0}`
      );
    }
  }

  const financials = calculateOrderFinancials(
    order.subscription?.pricing_tier || 'PRIVATE_STANDARD',
    order.card_count
  );

  await repo.updateOrderStatus(
    orderId,
    'CONFIRMED',
    userId,
    note?.slice(0, 500) || 'Order confirmed',
    {
      financials,
    }
  );

  // ✅ NOTIFICATION: Order Approved
  try {
    const updatedOrder = await repo.findOrderById(orderId, false);
    const school = await getSchoolWithContacts(updatedOrder.school_id);
    await notificationService.notifyOrder('ORDER_APPROVED', updatedOrder, school);
  } catch (err) {
    console.error('Failed to send ORDER_APPROVED notification:', err.message);
  }

  return { orderId, status: 'CONFIRMED', financials };
};

// =============================================================================
// INVOICE — ADVANCE
// =============================================================================

export const generateAdvanceInvoice = async (orderId, userId) => {
  const order = await repo.findOrderById(orderId, true);
  if (!order) throw ApiError.notFound('Order not found');

  assertValidTransition(order.status, 'PAYMENT_PENDING');

  if (order.advance_invoice_id) {
    return {
      invoice: order.advanceInvoice,
      amount: order.advance_amount,
      alreadyExisted: true,
    };
  }

  const { invoice, financials } = await repo.createAdvanceInvoice({
    schoolId: order.school_id,
    subscriptionId: order.subscription_id,
    orderId,
    cardCount: order.card_count,
    pricingTier: order.subscription?.pricing_tier || 'PRIVATE_STANDARD',
    customUnitPrice: null,
  });

  await repo.updateOrderStatus(orderId, 'PAYMENT_PENDING', userId, 'Advance invoice generated', {
    invoiceId: invoice.id,
  });

  // ✅ NOTIFICATION: Advance Invoice Ready
  try {
    const updatedOrder = await repo.findOrderById(orderId, false);
    const school = await getSchoolWithContacts(updatedOrder.school_id);
    await notificationService.notifyOrder('ADVANCE_INVOICE_READY', updatedOrder, school, {
      invoiceNumber: invoice.invoice_number,
      amount: financials.advanceAmount / 100,
      dueDate: invoice.due_at,
    });
  } catch (err) {
    console.error('Failed to send ADVANCE_INVOICE_READY notification:', err.message);
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
      `Cannot record advance payment. Order is in ${order.status} state — expected PAYMENT_PENDING`
    );
  }

  const invoice = order.advanceInvoice;
  if (!invoice) {
    throw ApiError.badRequest(
      'Advance invoice not found. Generate the advance invoice first via POST /orders/:id/invoice/advance'
    );
  }

  if (invoice.status === 'PAID') {
    throw ApiError.badRequest('Advance invoice is already marked as paid');
  }

  // Validate amount
  const expectedAmount = order.advance_amount || invoice.total_amount;
  if (
    paymentData.amount_received < expectedAmount &&
    paymentData.amount_received !== expectedAmount
  ) {
    throw ApiError.badRequest(`Advance payment should be ₹${(expectedAmount / 100).toFixed(2)}`);
  }

  const payment = await repo.recordPayment({
    orderId,
    invoiceId: invoice.id,
    schoolId: order.school_id,
    subscriptionId: order.subscription_id,
    amount: paymentData.amount_received,
    paymentMode: paymentData.payment_mode,
    paymentRef: paymentData.payment_ref,
    isAdvance: true,
    userId,
  });

  const isFull = paymentData.amount_received >= expectedAmount;

  await repo.updateOrderPayment(
    orderId,
    'PARTIALLY_PAID',
    userId,
    true,
    paymentData.amount_received,
    paymentData.payment_ref
  );

  // ✅ NOTIFICATION: Advance Payment Received
  try {
    const updatedOrder = await repo.findOrderById(orderId, false);
    const school = await getSchoolWithContacts(updatedOrder.school_id);
    await notificationService.notifyOrder('ADVANCE_PAYMENT_RECEIVED', updatedOrder, school, {
      amount: paymentData.amount_received / 100,
      reference: paymentData.payment_ref,
    });
  } catch (err) {
    console.error('Failed to send ADVANCE_PAYMENT_RECEIVED notification:', err.message);
  }

  return {
    payment,
    invoiceId: invoice.id,
    amountReceived: paymentData.amount_received,
    advanceAmount: expectedAmount,
    fullyPaid: isFull,
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
      `Cannot record balance payment. Order is in ${order.status} state — expected BALANCE_PENDING`
    );
  }

  let balanceInvoice = order.balanceInvoice;
  if (!balanceInvoice && order.balance_invoice_id) {
    balanceInvoice = await repo.findInvoiceById(order.balance_invoice_id);
  }

  if (!balanceInvoice) {
    const financials = calculateOrderFinancials(
      order.subscription?.pricing_tier || 'PRIVATE_STANDARD',
      order.card_count
    );
    const { invoice } = await repo.createBalanceInvoice({
      schoolId: order.school_id,
      subscriptionId: order.subscription_id,
      orderId,
      cardCount: order.card_count,
      unitPrice: financials.unitPrice,
      balanceAmount: financials.balanceAmount,
      taxAmount: financials.taxAmount,
    });
    balanceInvoice = invoice;
  }

  if (balanceInvoice.status === 'PAID') {
    throw ApiError.badRequest('Balance invoice is already marked as paid');
  }

  const payment = await repo.recordPayment({
    orderId,
    invoiceId: balanceInvoice.id,
    schoolId: order.school_id,
    subscriptionId: order.subscription_id,
    amount: paymentData.amount_received,
    paymentMode: paymentData.payment_mode,
    paymentRef: paymentData.payment_ref,
    isAdvance: false,
    userId,
  });

  await repo.updateOrderPayment(
    orderId,
    'PAID',
    userId,
    false,
    paymentData.amount_received,
    paymentData.payment_ref
  );

  if (order.subscription_id) {
    await repo.markSubscriptionPaid(order.subscription_id);
  }

  // ✅ NOTIFICATION: Order Completed
  try {
    const updatedOrder = await repo.findOrderById(orderId, false);
    const school = await getSchoolWithContacts(updatedOrder.school_id);
    await notificationService.notifyOrder('ORDER_COMPLETED', updatedOrder, school, {
      totalAmount: (order.grand_total || 0) / 100,
    });
  } catch (err) {
    console.error('Failed to send ORDER_COMPLETED notification:', err.message);
  }

  return {
    payment,
    invoiceId: balanceInvoice.id,
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

  assertValidTransition(order.status, 'SENT_TO_VENDOR');

  const updated = await repo.assignVendor(orderId, vendorId, userId, notes?.slice(0, 500));

  // ✅ NOTIFICATION: Vendor Assigned
  try {
    const fullOrder = await repo.findOrderById(orderId, true);
    const school = await getSchoolWithContacts(fullOrder.school_id);
    await notificationService.notifyOrder('VENDOR_ASSIGNED', fullOrder, school, {
      vendorName: fullOrder.vendor?.name,
    });
  } catch (err) {
    console.error('Failed to send VENDOR_ASSIGNED notification:', err.message);
  }

  return updated;
};

export const updatePrinting = async (orderId, status, userId, note) => {
  const order = await repo.findOrderById(orderId, true);
  if (!order) throw ApiError.notFound('Order not found');

  if (status === 'STARTED') {
    assertValidTransition(order.status, 'PRINTING');
  } else if (status === 'COMPLETED') {
    assertValidTransition(order.status, 'PRINT_COMPLETE');
  }

  const updated = await repo.updatePrintingStatus(orderId, status, userId, note?.slice(0, 500));

  // ✅ NOTIFICATION: Printing Started
  if (status === 'STARTED') {
    try {
      const fullOrder = await repo.findOrderById(orderId, false);
      const school = await getSchoolWithContacts(fullOrder.school_id);
      await notificationService.notifyOrder('PRINTING_STARTED', fullOrder, school, {
        expectedDays: 7,
      });
    } catch (err) {
      console.error('Failed to send PRINTING_STARTED notification:', err.message);
    }
  }

  return updated;
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

  // ✅ NOTIFICATION: Order Shipped
  try {
    const fullOrder = await repo.findOrderById(orderId, true);
    const school = await getSchoolWithContacts(fullOrder.school_id);
    await notificationService.notifyOrder('SHIPPED', fullOrder, school, {
      awbCode: fullOrder.shipment?.awb_code,
      trackingUrl: fullOrder.shipment?.tracking_url,
      courierName: fullOrder.shipment?.courier_name,
    });
  } catch (err) {
    console.error('Failed to send SHIPPED notification:', err.message);
  }

  return { orderId, status: 'SHIPPED' };
};

// =============================================================================
// DELIVERY — CONFIRM
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

  // ✅ NOTIFICATION: Order Delivered
  try {
    const fullOrder = await repo.findOrderById(orderId, false);
    const school = await getSchoolWithContacts(fullOrder.school_id);
    await notificationService.notifyOrder('DELIVERED', fullOrder, school);
  } catch (err) {
    console.error('Failed to send DELIVERED notification:', err.message);
  }

  // ✅ NOTIFICATION: Balance Invoice Ready (if balance invoice was created)
  if (balanceInvoice) {
    try {
      const fullOrder = await repo.findOrderById(orderId, false);
      const school = await getSchoolWithContacts(fullOrder.school_id);
      await notificationService.notifyOrder('BALANCE_INVOICE_READY', fullOrder, school, {
        invoiceNumber: balanceInvoice.invoice_number,
        amount: balanceInvoice.total_amount / 100,
        dueDate: balanceInvoice.due_at,
      });
    } catch (err) {
      console.error('Failed to send BALANCE_INVOICE_READY notification:', err.message);
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
    balanceDueAt: updatedOrder.balance_due_at,
  };
};

// =============================================================================
// INVOICE — GET FOR DOWNLOAD
// =============================================================================

export const getInvoiceForDownload = async invoiceId => {
  const invoice = await repo.findInvoiceById(invoiceId);
  if (!invoice) throw ApiError.notFound('Invoice not found');
  return invoice;
};

export const getOrderInvoice = async (orderId, type) => {
  if (!['ADVANCE', 'BALANCE'].includes(type)) {
    throw ApiError.badRequest('Invoice type must be ADVANCE or BALANCE');
  }
  const invoice = await repo.findInvoiceByOrderAndType(orderId, type);
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
    throw ApiError.badRequest(
      `Order cannot be cancelled at this stage (${order.status}). Orders can only be cancelled before shipping.`
    );
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

  // ✅ NOTIFICATION: Order Cancelled
  try {
    const cancelledOrder = await repo.findOrderById(orderId, false);
    const school = await getSchoolWithContacts(cancelledOrder.school_id);
    await notificationService.notifyOrder('ORDER_CANCELLED', cancelledOrder, school, {
      reason: reason?.slice(0, 500) || 'Cancelled by admin',
    });
  } catch (err) {
    console.error('Failed to send ORDER_CANCELLED notification:', err.message);
  }

  return {
    orderId,
    status: 'CANCELLED',
    requiresRefund: requiresRefund(order.status),
  };
};

// =============================================================================
// ORDER STATUS (simple)
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
