// =============================================================================
// order.validation.js — RESQID
// Zod v4 schemas for every order endpoint.
// =============================================================================

import { z } from "zod";

// =============================================================================
// SHARED
// =============================================================================

const pincodeSchema = z.string().regex(/^\d{6}$/, "Pincode must be 6 digits");

const deliverySchema = z
  .object({
    delivery_name: z.string().min(2).max(100),
    delivery_phone: z.string().regex(/^\+?[\d\s-]{8,15}$/, "Invalid phone"),
    delivery_address: z.string().min(5).max(300),
    delivery_city: z.string().min(2).max(100),
    delivery_state: z.string().min(2).max(100),
    delivery_pincode: pincodeSchema,
    delivery_notes: z.string().max(500).optional(),
  })
  .strict();

const partialDeliverySchema = deliverySchema.partial();

const paymentBodySchema = z
  .object({
    amount_received: z
      .number()
      .int()
      .positive({ message: "Amount must be positive paise" }),
    payment_mode: z.enum([
      "BANK_TRANSFER",
      "UPI",
      "CHEQUE",
      "RAZORPAY",
      "CASH",
    ]),
    payment_ref: z.string().min(1).max(100).optional(),
    note: z.string().max(500).optional(),
  })
  .strict();

// =============================================================================
// CREATE ORDER
// POST /api/orders
// =============================================================================

export const createOrderSchema = z.object({
  body: z
    .object({
      school_id: z.string().uuid(),
      channel: z.enum(["DASHBOARD", "CALL"]),
      order_type: z.enum(["BLANK", "PRE_DETAILS"]),
      // FIX [V-1]: was max(5000) but step4 hard cap is MAX_CARDS_PER_ORDER=1500.
      // Mismatched limits meant an admin could create an order with 3000 cards,
      // pass validation, then get a silent hard error at generate time.
      // Now consistent: validation rejects at input, before any DB write.
      card_count: z.number().int().min(1).max(1500),

      // Delivery — required for DASHBOARD, optional for CALL
      delivery: partialDeliverySchema.optional(),

      // CALL channel context
      caller_name: z.string().max(100).optional(),
      caller_phone: z
        .string()
        .regex(/^\+?[\d\s-]{8,15}$/)
        .optional(),
      call_notes: z.string().max(1000).optional(),

      notes: z.string().max(1000).optional(),
      admin_notes: z.string().max(1000).optional(),
    })
    .strict()
    .superRefine((data, ctx) => {
      // DASHBOARD requires complete delivery address
      if (data.channel === "DASHBOARD") {
        const d = data.delivery ?? {};
        const required = [
          "delivery_name",
          "delivery_phone",
          "delivery_address",
          "delivery_city",
          "delivery_state",
          "delivery_pincode",
        ];
        required.forEach((field) => {
          if (!d[field]) {
            ctx.addIssue({
              code: z.ZodIssueCode.custom,
              path: ["delivery", field],
              message: `${field} is required for DASHBOARD orders`,
            });
          }
        });
      }
    }),
});

// =============================================================================
// CONFIRM ORDER
// PATCH /api/orders/:id/confirm
// =============================================================================

export const confirmOrderSchema = z.object({
  params: z.object({ id: z.string().uuid() }),
  body: z
    .object({
      delivery: partialDeliverySchema.optional(),
      // SEC: custom_unit_price is ENTERPRISE-only. min(1) prevents ₹0 price bypass.
      // The business logic layer (step2.confirm) must verify pricing_tier === ENTERPRISE
      // before honouring this override.
      custom_unit_price: z.number().int().min(1).optional(),
      note: z.string().max(500).optional(),
    })
    .strict(),
});

// =============================================================================
// SEND ADVANCE INVOICE
// POST /api/orders/:id/invoice/advance
// =============================================================================

export const advanceInvoiceSchema = z.object({
  params: z.object({ id: z.string().uuid() }),
  body: z
    .object({
      due_at: z.string().datetime().optional(),
      note: z.string().max(500).optional(),
    })
    .strict(),
});

// =============================================================================
// MARK ADVANCE PAID
// PATCH /api/orders/:id/payment/advance
// =============================================================================

export const advancePaymentSchema = z.object({
  params: z.object({ id: z.string().uuid() }),
  body: paymentBodySchema,
});

// =============================================================================
// GENERATE TOKENS
// POST /api/orders/:id/generate
// =============================================================================

export const generateTokensSchema = z.object({
  params: z.object({ id: z.string().uuid() }),
  body: z
    .object({
      note: z.string().max(500).optional(),
    })
    .strict(),
});

// =============================================================================
// CARD DESIGN
// POST /api/orders/:id/design
// POST /api/orders/:id/design/retry
// =============================================================================

export const cardDesignSchema = z.object({
  params: z.object({ id: z.string().uuid() }),
  body: z
    .object({
      note: z.string().max(500).optional(),
    })
    .strict(),
});

// =============================================================================
// SEND TO VENDOR
// PATCH /api/orders/:id/vendor
// =============================================================================

export const vendorSchema = z.object({
  params: z.object({ id: z.string().uuid() }),
  body: z
    .object({
      vendor_id: z.string().uuid(),
      vendor_notes: z.string().max(1000).optional(),
      note: z.string().max(500).optional(),
    })
    .strict(),
});

// =============================================================================
// PRINTING
// PATCH /api/orders/:id/printing/start
// PATCH /api/orders/:id/printing/complete
// =============================================================================

export const printingSchema = z.object({
  params: z.object({ id: z.string().uuid() }),
  body: z
    .object({
      note: z.string().max(500).optional(),
    })
    .strict(),
});

// =============================================================================
// CREATE SHIPMENT
// POST /api/orders/:id/shipment
// =============================================================================

export const createShipmentSchema = z.object({
  params: z.object({ id: z.string().uuid() }),
  body: z
    .object({
      shiprocket_order_id: z.string().max(100).optional(),
      shiprocket_shipment_id: z.string().max(100).optional(),
      awb_code: z.string().max(100).optional(),
      courier_name: z.string().max(100).optional(),
      tracking_url: z.string().url().optional(),
      label_url: z.string().url().optional(),
      note: z.string().max(500).optional(),
    })
    .strict(),
});

// =============================================================================
// MARK SHIPPED / DELIVERED
// =============================================================================

export const shippedSchema = z.object({
  params: z.object({ id: z.string().uuid() }),
  body: z
    .object({
      tracking_url: z.string().url().optional(),
      note: z.string().max(500).optional(),
    })
    .strict(),
});

export const deliveredSchema = z.object({
  params: z.object({ id: z.string().uuid() }),
  body: z
    .object({
      note: z.string().max(500).optional(),
    })
    .strict(),
});

// =============================================================================
// BALANCE INVOICE + PAYMENT
// =============================================================================

export const balanceInvoiceSchema = z.object({
  params: z.object({ id: z.string().uuid() }),
  body: z
    .object({
      due_at: z.string().datetime().optional(),
      note: z.string().max(500).optional(),
    })
    .strict(),
});

export const balancePaymentSchema = z.object({
  params: z.object({ id: z.string().uuid() }),
  body: paymentBodySchema,
});

// =============================================================================
// CANCEL + REFUND
// =============================================================================

export const cancelOrderSchema = z.object({
  params: z.object({ id: z.string().uuid() }),
  body: z
    .object({
      reason: z.string().min(5, "Cancellation reason required").max(500),
    })
    .strict(),
});

export const refundOrderSchema = z.object({
  params: z.object({ id: z.string().uuid() }),
  body: z
    .object({
      amount_refunded: z.number().int().positive(),
      refund_ref: z.string().min(1).max(100).optional(),
      payment_mode: z.enum([
        "BANK_TRANSFER",
        "UPI",
        "CHEQUE",
        "RAZORPAY",
        "CASH",
      ]),
      note: z.string().max(500).optional(),
    })
    .strict(),
});

// =============================================================================
// LIST ORDERS (query params)
// GET /api/orders
// =============================================================================

export const listOrdersSchema = z.object({
  query: z.object({
    page: z.coerce.number().int().min(1).default(1),
    limit: z.coerce.number().int().min(1).max(100).default(20),
    status: z.string().optional(),
    school_id: z.string().uuid().optional(),
    channel: z.enum(["DASHBOARD", "CALL"]).optional(),
  }),
});
