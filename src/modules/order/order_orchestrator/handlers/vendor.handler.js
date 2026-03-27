// =============================================================================
// handlers/vendor.handler.js
// Business logic for vendor management.
// =============================================================================

import { prisma } from '#config/database/prisma.js';

/**
 * Find best vendor for order based on location and workload
 */
export async function findBestVendor(orderId) {
  const order = await prisma.cardOrder.findUnique({
    where: { id: orderId },
    select: {
      school_id: true,
      delivery_city: true,
      delivery_state: true,
      card_count: true,
    },
  });

  if (!order) {
    throw new Error(`Order ${orderId} not found`);
  }

  // Find active vendors
  const vendors = await prisma.vendorProfile.findMany({
    where: { status: 'ACTIVE' },
    orderBy: { avg_turnaround_days: 'asc' },
  });

  if (vendors.length === 0) {
    throw new Error('No active vendors available');
  }

  // Simple round-robin selection based on workload
  // In production, this would consider location, current workload, etc.
  const vendor = vendors[0];

  return vendor;
}

/**
 * Assign vendor to order
 */
export async function assignVendorToOrder(orderId, vendorId, assignedBy) {
  const order = await prisma.cardOrder.findUnique({
    where: { id: orderId },
    include: {
      vendor: true,
      school: {
        select: { name: true, email: true, phone: true, address: true },
      },
    },
  });

  if (!order) {
    throw new Error(`Order ${orderId} not found`);
  }

  const vendor = await prisma.vendorProfile.findUnique({
    where: { id: vendorId },
  });

  if (!vendor) {
    throw new Error(`Vendor ${vendorId} not found`);
  }

  // Update order with vendor
  const updatedOrder = await prisma.cardOrder.update({
    where: { id: orderId },
    data: {
      vendor_id: vendorId,
      files_sent_to_vendor_at: new Date(),
      files_sent_by: assignedBy,
      vendor_notes: `Assigned to ${vendor.name} by ${assignedBy}`,
    },
  });

  // Create audit log
  await prisma.auditLog.create({
    data: {
      school_id: order.school_id,
      actor_id: assignedBy,
      actor_type: 'SUPER_ADMIN',
      action: 'VENDOR_ASSIGNED',
      entity: 'CardOrder',
      entity_id: orderId,
      new_value: { vendorId, vendorName: vendor.name },
    },
  });

  return {
    order: updatedOrder,
    vendor,
  };
}

/**
 * Send design files to vendor
 */
export async function sendDesignsToVendor(orderId, sentBy) {
  const order = await prisma.cardOrder.findUnique({
    where: { id: orderId },
    include: {
      vendor: true,
    },
  });

  if (!order) {
    throw new Error(`Order ${orderId} not found`);
  }

  if (!order.vendor_id) {
    throw new Error(`No vendor assigned for order ${orderId}`);
  }

  if (!order.card_design_files) {
    throw new Error(`No design files generated for order ${orderId}`);
  }

  // In production, this would send email or API call to vendor
  const sentAt = new Date();

  const updatedOrder = await prisma.cardOrder.update({
    where: { id: orderId },
    data: {
      files_sent_to_vendor_at: sentAt,
      files_sent_by: sentBy,
    },
  });

  return {
    sentAt,
    vendor: order.vendor,
    designFiles: order.card_design_files,
  };
}

/**
 * Update vendor details
 */
export async function updateVendor(vendorId, data, updatedBy) {
  const vendor = await prisma.vendorProfile.update({
    where: { id: vendorId },
    data: {
      ...data,
      updated_at: new Date(),
    },
  });

  await prisma.auditLog.create({
    data: {
      actor_id: updatedBy,
      actor_type: 'SUPER_ADMIN',
      action: 'VENDOR_UPDATED',
      entity: 'VendorProfile',
      entity_id: vendorId,
      new_value: data,
    },
  });

  return vendor;
}

/**
 * Create new vendor
 */
export async function createVendor(data, createdBy) {
  const vendor = await prisma.vendorProfile.create({
    data: {
      ...data,
      status: data.status || 'ACTIVE',
    },
  });

  await prisma.auditLog.create({
    data: {
      actor_id: createdBy,
      actor_type: 'SUPER_ADMIN',
      action: 'VENDOR_CREATED',
      entity: 'VendorProfile',
      entity_id: vendor.id,
      new_value: data,
    },
  });

  return vendor;
}

/**
 * Get vendor performance metrics
 */
export async function getVendorMetrics(vendorId, fromDate, toDate) {
  const orders = await prisma.cardOrder.findMany({
    where: {
      vendor_id: vendorId,
      created_at: {
        gte: fromDate,
        lte: toDate,
      },
    },
    select: {
      id: true,
      status: true,
      created_at: true,
      print_complete_at: true,
      card_count: true,
    },
  });

  const completedOrders = orders.filter(o => o.status === 'COMPLETED' || o.status === 'DELIVERED');
  const totalCards = orders.reduce((sum, o) => sum + o.card_count, 0);
  const completedCards = completedOrders.reduce((sum, o) => sum + o.card_count, 0);

  let totalTurnaround = 0;
  for (const order of completedOrders) {
    if (order.print_complete_at) {
      const turnaround = order.print_complete_at.getTime() - order.created_at.getTime();
      totalTurnaround += turnaround;
    }
  }

  const avgTurnaroundDays =
    completedOrders.length > 0
      ? Math.round(totalTurnaround / completedOrders.length / (1000 * 60 * 60 * 24))
      : 0;

  return {
    totalOrders: orders.length,
    completedOrders: completedOrders.length,
    totalCards,
    completedCards,
    avgTurnaroundDays,
    orders: orders.slice(0, 50),
  };
}
