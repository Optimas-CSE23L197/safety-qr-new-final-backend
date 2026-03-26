// =============================================================================
// order.controller.js — RESQID (HTTP Layer)
// =============================================================================

import * as orderService from "./order.service.js";
import { ApiResponse } from "../../utils/response/ApiResponse.js";
import { asyncHandler } from "../../utils/response/asyncHandler.js";

// =============================================================================
// ORDER CRUD
// =============================================================================

export const createOrder = asyncHandler(async (req, res) => {
  const result = await orderService.createNewOrder({
    ...req.body,
    userId: req.user.id,
    userRole: req.user.role,
  });

  res
    .status(201)
    .json(new ApiResponse(201, result, "Order created successfully"));
});

export const listOrders = asyncHandler(async (req, res) => {
  const result = await orderService.listOrders(req.query, req.user);
  res.json(new ApiResponse(200, result, "Orders retrieved successfully"));
});

export const getOrderDetails = asyncHandler(async (req, res) => {
  const { orderId } = req.params;
  const result = await orderService.getOrderDetails(orderId, req.user);
  res.json(new ApiResponse(200, result, "Order details retrieved"));
});

export const getOrderStatus = asyncHandler(async (req, res) => {
  const { orderId } = req.params;
  const result = await orderService.getOrderStatus(orderId);
  res.json(new ApiResponse(200, result, "Order status retrieved"));
});

// =============================================================================
// CONFIRM & INVOICE
// =============================================================================

export const confirmOrder = asyncHandler(async (req, res) => {
  const { orderId } = req.params;
  const { note } = req.body;
  const result = await orderService.confirmOrder(orderId, req.user.id, note);
  res.json(new ApiResponse(200, result, "Order confirmed"));
});

export const generateAdvanceInvoice = asyncHandler(async (req, res) => {
  const { orderId } = req.params;
  const result = await orderService.generateAdvanceInvoice(
    orderId,
    req.user.id,
  );
  res.json(new ApiResponse(200, result, "Advance invoice generated"));
});

// =============================================================================
// INVOICE — DOWNLOAD
// =============================================================================

export const downloadInvoice = asyncHandler(async (req, res) => {
  const { orderId, type } = req.params;
  const invoice = await orderService.getOrderInvoice(
    orderId,
    type.toUpperCase(),
  );
  res.json(new ApiResponse(200, invoice, "Invoice retrieved"));
});

export const getInvoiceById = asyncHandler(async (req, res) => {
  const { invoiceId } = req.params;
  const invoice = await orderService.getInvoiceForDownload(invoiceId);
  res.json(new ApiResponse(200, invoice, "Invoice retrieved"));
});

// =============================================================================
// PAYMENT
// =============================================================================

export const recordAdvancePayment = asyncHandler(async (req, res) => {
  const { orderId } = req.params;
  const result = await orderService.recordAdvancePayment(
    orderId,
    req.body,
    req.user.id,
  );
  res.json(new ApiResponse(200, result, "Advance payment recorded"));
});

export const recordBalancePayment = asyncHandler(async (req, res) => {
  const { orderId } = req.params;
  const result = await orderService.recordBalancePayment(
    orderId,
    req.body,
    req.user.id,
  );
  res.json(new ApiResponse(200, result, "Balance payment recorded"));
});

// =============================================================================
// TOKEN GENERATION (Orchestrator trigger)
// =============================================================================

export const generateTokens = asyncHandler(async (req, res) => {
  const { orderId } = req.params;
  // TODO: Trigger token.worker via orchestrator
  res.json(
    new ApiResponse(
      202,
      { orderId, status: "queued" },
      "Token generation queued",
    ),
  );
});

// =============================================================================
// CARD DESIGN (Orchestrator trigger)
// =============================================================================

export const generateCardDesigns = asyncHandler(async (req, res) => {
  const { orderId } = req.params;
  // TODO: Trigger design.worker via orchestrator
  res.json(
    new ApiResponse(
      202,
      { orderId, status: "queued" },
      "Card design generation queued",
    ),
  );
});

// =============================================================================
// VENDOR
// =============================================================================

export const assignVendor = asyncHandler(async (req, res) => {
  const { orderId } = req.params;
  const { vendor_id, vendor_notes, note } = req.body;
  const result = await orderService.assignVendorToOrder(
    orderId,
    vendor_id,
    req.user.id,
    vendor_notes || note,
  );
  res.json(new ApiResponse(200, result, "Vendor assigned"));
});

// =============================================================================
// PRINTING
// =============================================================================

export const updatePrintingStatus = asyncHandler(async (req, res) => {
  const { orderId } = req.params;
  const { status, note } = req.body;
  const result = await orderService.updatePrinting(
    orderId,
    status,
    req.user.id,
    note,
  );
  res.json(new ApiResponse(200, result, `Printing ${status.toLowerCase()}`));
});

// =============================================================================
// SHIPMENT
// =============================================================================

export const createShipment = asyncHandler(async (req, res) => {
  const { orderId } = req.params;
  const result = await orderService.createShipmentForOrder(
    orderId,
    req.body,
    req.user.id,
  );
  res.json(new ApiResponse(200, result, "Shipment created"));
});

export const markShipmentShipped = asyncHandler(async (req, res) => {
  const { orderId } = req.params;
  const { note } = req.body;
  const result = await orderService.markShipmentShipped(
    orderId,
    req.user.id,
    note,
  );
  res.json(new ApiResponse(200, result, "Shipment marked as shipped"));
});

// =============================================================================
// DELIVERY
// =============================================================================

export const confirmDelivery = asyncHandler(async (req, res) => {
  const { orderId } = req.params;
  const { note } = req.body;
  const result = await orderService.confirmDelivery(orderId, req.user.id, note);
  res.json(new ApiResponse(200, result, "Delivery confirmed"));
});

// =============================================================================
// CANCELLATION
// =============================================================================

export const cancelOrder = asyncHandler(async (req, res) => {
  const { orderId } = req.params;
  const { reason, notes } = req.body;
  const result = await orderService.cancelOrder(
    orderId,
    req.user.id,
    reason,
    notes,
  );
  res.json(new ApiResponse(200, result, "Order cancelled"));
});
