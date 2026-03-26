// =============================================================================
// handlers/delivery.handler.js
// Business logic for delivery confirmation.
// =============================================================================

import { prisma } from "../../../config/prisma.js";

/**
 * Confirm delivery of order
 */
export async function confirmDelivery(
  orderId,
  confirmedBy,
  deliveryDetails = {},
) {
  const order = await prisma.cardOrder.findUnique({
    where: { id: orderId },
    include: {
      shipment: true,
      school: true,
    },
  });

  if (!order) {
    throw new Error(`Order ${orderId} not found`);
  }

  if (order.status !== "SHIPPED") {
    throw new Error(`Order ${orderId} is not in SHIPPED state`);
  }

  const deliveredAt = new Date();

  // Update shipment
  if (order.shipment) {
    await prisma.orderShipment.update({
      where: { id: order.shipment.id },
      data: {
        status: "DELIVERED",
        shiprocket_status: "DELIVERED",
        delivered_at: deliveredAt,
        delivery_confirmed_by: confirmedBy,
      },
    });
  }

  // Update order
  const updatedOrder = await prisma.cardOrder.update({
    where: { id: orderId },
    data: {
      status: "DELIVERED",
      status_changed_by: confirmedBy,
      status_changed_at: deliveredAt,
      status_note: deliveryDetails.notes,
    },
  });

  // Create status log
  await prisma.orderStatusLog.create({
    data: {
      order_id: orderId,
      from_status: "SHIPPED",
      to_status: "DELIVERED",
      changed_by: confirmedBy,
      note: deliveryDetails.notes || "Delivery confirmed",
      metadata: {
        deliveredAt,
        ...deliveryDetails,
      },
    },
  });

  // Send notification to school
  // This will be handled by the event publisher

  return {
    order: updatedOrder,
    deliveredAt,
    confirmedBy,
  };
}

/**
 * Mark delivery as failed (return to sender)
 */
export async function markDeliveryFailed(orderId, failedBy, reason) {
  const order = await prisma.cardOrder.findUnique({
    where: { id: orderId },
    include: {
      shipment: true,
    },
  });

  if (!order) {
    throw new Error(`Order ${orderId} not found`);
  }

  // Update shipment
  if (order.shipment) {
    await prisma.orderShipment.update({
      where: { id: order.shipment.id },
      data: {
        status: "FAILED",
        shiprocket_status: "RTO_INITIATED",
        notes: reason,
      },
    });
  }

  // Update order
  const updatedOrder = await prisma.cardOrder.update({
    where: { id: orderId },
    data: {
      status: "FAILED",
      status_note: `Delivery failed: ${reason}`,
      status_changed_by: failedBy,
      status_changed_at: new Date(),
    },
  });

  // Create status log
  await prisma.orderStatusLog.create({
    data: {
      order_id: orderId,
      from_status: "SHIPPED",
      to_status: "FAILED",
      changed_by: failedBy,
      note: `Delivery failed: ${reason}`,
    },
  });

  return updatedOrder;
}

/**
 * Get delivery status for order
 */
export async function getDeliveryStatus(orderId) {
  const order = await prisma.cardOrder.findUnique({
    where: { id: orderId },
    include: {
      shipment: true,
    },
  });

  if (!order) {
    return null;
  }

  return {
    orderId: order.id,
    orderNumber: order.order_number,
    status: order.status,
    deliveryStatus: order.shipment?.status,
    tracking: order.shipment
      ? {
          awbCode: order.shipment.awb_code,
          trackingUrl: order.shipment.tracking_url,
          courier: order.shipment.courier_name,
          status: order.shipment.shiprocket_status,
        }
      : null,
    deliveredAt: order.shipment?.delivered_at,
    deliveryAddress: {
      name: order.shipment?.delivery_name,
      phone: order.shipment?.delivery_phone,
      address: order.shipment?.delivery_address,
      city: order.shipment?.delivery_city,
      state: order.shipment?.delivery_state,
      pincode: order.shipment?.delivery_pincode,
    },
  };
}
