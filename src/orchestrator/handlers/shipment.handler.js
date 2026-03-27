// =============================================================================
// handlers/shipment.handler.js
// Business logic for shipment management.
// =============================================================================

import { prisma } from '#config/prisma.js';

/**
 * Create shipment for order
 */
export async function createShipment(orderId, shipmentData, createdBy) {
  const order = await prisma.cardOrder.findUnique({
    where: { id: orderId },
    include: {
      vendor: true,
      school: true,
    },
  });

  if (!order) {
    throw new Error(`Order ${orderId} not found`);
  }

  // Generate AWB code if not provided
  const awbCode = shipmentData.awbCode || `AWB-${Date.now()}-${order.order_number}`;
  const trackingUrl = shipmentData.trackingUrl || `https://shiprocket.co/track/${awbCode}`;

  // Create shipment record
  const shipment = await prisma.orderShipment.create({
    data: {
      order_id: orderId,
      awb_code: awbCode,
      courier_name: shipmentData.courierName || 'Shiprocket Standard',
      tracking_url: trackingUrl,
      status: 'PENDING',
      shiprocket_status: 'PENDING',
      created_by: createdBy,
      pickup_vendor_id: order.vendor_id,
      pickup_name: order.vendor?.name,
      pickup_contact: order.vendor?.phone,
      pickup_address: order.vendor?.address,
      delivery_name: shipmentData.deliveryName || order.delivery_name,
      delivery_phone: shipmentData.deliveryPhone || order.delivery_phone,
      delivery_address: shipmentData.deliveryAddress || order.delivery_address,
      delivery_city: shipmentData.deliveryCity || order.delivery_city,
      delivery_state: shipmentData.deliveryState || order.delivery_state,
      delivery_pincode: shipmentData.deliveryPincode || order.delivery_pincode,
      notes: shipmentData.notes,
    },
  });

  // Update order status
  await prisma.cardOrder.update({
    where: { id: orderId },
    data: {
      status: 'READY_TO_SHIP',
    },
  });

  // Create status log
  await prisma.orderStatusLog.create({
    data: {
      order_id: orderId,
      from_status: 'PRINT_COMPLETE',
      to_status: 'READY_TO_SHIP',
      changed_by: createdBy,
      note: 'Shipment created, ready for pickup',
      metadata: { awbCode, trackingUrl },
    },
  });

  return shipment;
}

/**
 * Update shipment tracking
 */
export async function updateShipmentTracking(orderId, trackingData) {
  const shipment = await prisma.orderShipment.findFirst({
    where: { order_id: orderId },
  });

  if (!shipment) {
    throw new Error(`No shipment found for order ${orderId}`);
  }

  const updatedShipment = await prisma.orderShipment.update({
    where: { id: shipment.id },
    data: {
      status: trackingData.status,
      shiprocket_status: trackingData.shiprocketStatus,
      picked_up_at: trackingData.pickedUpAt ? new Date(trackingData.pickedUpAt) : undefined,
      estimated_delivery_at: trackingData.estimatedDeliveryAt
        ? new Date(trackingData.estimatedDeliveryAt)
        : undefined,
      delivered_at: trackingData.deliveredAt ? new Date(trackingData.deliveredAt) : undefined,
    },
  });

  // Update order status if shipped or delivered
  if (trackingData.status === 'SHIPPED') {
    await prisma.cardOrder.update({
      where: { id: orderId },
      data: { status: 'SHIPPED' },
    });
  } else if (trackingData.status === 'DELIVERED') {
    await prisma.cardOrder.update({
      where: { id: orderId },
      data: { status: 'DELIVERED' },
    });
  }

  // Create tracking log
  await prisma.orderStatusLog.create({
    data: {
      order_id: orderId,
      from_status: shipment.status,
      to_status: trackingData.status,
      changed_by: 'system',
      note: `Shipment status updated to ${trackingData.status}`,
      metadata: trackingData,
    },
  });

  return updatedShipment;
}

/**
 * Mark shipment as delivered
 */
export async function markShipmentDelivered(orderId, confirmedBy) {
  const shipment = await prisma.orderShipment.findFirst({
    where: { order_id: orderId },
  });

  if (!shipment) {
    throw new Error(`No shipment found for order ${orderId}`);
  }

  const deliveredAt = new Date();

  const updatedShipment = await prisma.orderShipment.update({
    where: { id: shipment.id },
    data: {
      status: 'DELIVERED',
      shiprocket_status: 'DELIVERED',
      delivered_at: deliveredAt,
      delivery_confirmed_by: confirmedBy,
    },
  });

  // Update order
  await prisma.cardOrder.update({
    where: { id: orderId },
    data: {
      status: 'DELIVERED',
    },
  });

  // Create status log
  await prisma.orderStatusLog.create({
    data: {
      order_id: orderId,
      from_status: 'SHIPPED',
      to_status: 'DELIVERED',
      changed_by: confirmedBy,
      note: 'Shipment delivered and confirmed',
      metadata: { deliveredAt },
    },
  });

  return updatedShipment;
}

/**
 * Get shipment details
 */
export async function getShipmentDetails(orderId) {
  const shipment = await prisma.orderShipment.findFirst({
    where: { order_id: orderId },
  });

  if (!shipment) {
    return null;
  }

  return {
    id: shipment.id,
    awbCode: shipment.awb_code,
    courierName: shipment.courier_name,
    trackingUrl: shipment.tracking_url,
    status: shipment.status,
    shiprocketStatus: shipment.shiprocket_status,
    pickup: {
      vendorId: shipment.pickup_vendor_id,
      name: shipment.pickup_name,
      contact: shipment.pickup_contact,
      address: shipment.pickup_address,
    },
    delivery: {
      name: shipment.delivery_name,
      phone: shipment.delivery_phone,
      address: shipment.delivery_address,
      city: shipment.delivery_city,
      state: shipment.delivery_state,
      pincode: shipment.delivery_pincode,
    },
    timeline: {
      created: shipment.created_at,
      pickupScheduled: shipment.pickup_scheduled_at,
      pickedUp: shipment.picked_up_at,
      estimatedDelivery: shipment.estimated_delivery_at,
      delivered: shipment.delivered_at,
    },
    notes: shipment.notes,
  };
}
