// =============================================================================
// state/order.guards.js
// Guard functions — each returns { pass: boolean, reason?: string }
// Guards are checked BEFORE a state transition is executed.
// =============================================================================

import { prisma } from "../../../config/prisma.js";

/**
 * Guard: order exists and belongs to the correct school (if actor is school admin)
 */
export async function guardOrderExists(orderId) {
  const order = await prisma.cardOrder.findUnique({
    where: { id: orderId },
    select: { id: true, status: true, school_id: true },
  });

  if (!order) return { pass: false, reason: `Order ${orderId} not found` };
  return { pass: true, order };
}

/**
 * Guard: actor is super admin (only super admin can approve/cancel/override)
 */
export function guardSuperAdmin(actor) {
  if (!actor || actor.role !== "SUPER_ADMIN") {
    return { pass: false, reason: "Only Super Admin can perform this action" };
  }
  return { pass: true };
}

/**
 * Guard: actor is school admin (only school admin can create orders)
 */
export function guardSchoolAdmin(actor) {
  if (!actor || actor.role !== "SCHOOL_ADMIN") {
    return { pass: false, reason: "Only School Admin can create orders" };
  }
  return { pass: true };
}

/**
 * Guard: advance payment has NOT been received (precondition for cancellation)
 */
export async function guardNoAdvancePayment(orderId) {
  const order = await prisma.cardOrder.findUnique({
    where: { id: orderId },
    select: { payment_status: true },
  });

  if (!order) return { pass: false, reason: "Order not found" };

  if (
    order.payment_status === "PARTIALLY_PAID" ||
    order.payment_status === "PAID"
  ) {
    return {
      pass: false,
      reason: "Cannot cancel: advance payment has been received",
    };
  }

  return { pass: true };
}

/**
 * Guard: tokens have NOT been generated
 */
export async function guardNoTokens(orderId) {
  const count = await prisma.token.count({
    where: { order_id: orderId },
  });

  if (count > 0) {
    return {
      pass: false,
      reason: "Cannot cancel: tokens have already been generated",
    };
  }

  return { pass: true };
}

/**
 * Guard: printing has NOT started
 */
export async function guardNoPrinting(orderId) {
  const order = await prisma.cardOrder.findUnique({
    where: { id: orderId },
    select: { status: true },
  });

  const PRINTING_STATES = new Set([
    "PRINTING",
    "PRINT_COMPLETE",
    "READY_TO_SHIP",
    "SHIPPED",
    "DELIVERED",
    "COMPLETED",
  ]);

  if (PRINTING_STATES.has(order?.status)) {
    return {
      pass: false,
      reason: "Cannot cancel: printing has already started",
    };
  }

  return { pass: true };
}

/**
 * Guard: order has NOT been shipped
 */
export async function guardNotShipped(orderId) {
  const shipment = await prisma.orderShipment.findFirst({
    where: { order_id: orderId, status: { in: ["SHIPPED", "DELIVERED"] } },
  });

  if (shipment) {
    return {
      pass: false,
      reason: "Cannot cancel: order has already been shipped",
    };
  }

  return { pass: true };
}

/**
 * Run all cancellation guards in sequence.
 * Returns the first failure, or { pass: true } if all pass.
 */
export async function runCancellationGuards(orderId) {
  const checks = [
    guardNoAdvancePayment(orderId),
    guardNoTokens(orderId),
    guardNoPrinting(orderId),
    guardNotShipped(orderId),
  ];

  const results = await Promise.all(checks);

  for (const result of results) {
    if (!result.pass) return result;
  }

  return { pass: true };
}
