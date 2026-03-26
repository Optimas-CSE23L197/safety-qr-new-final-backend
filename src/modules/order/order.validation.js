// =============================================================================
// order.validation.js — RESQID (SECURITY ENHANCED)
// =============================================================================

import { z } from "zod";

// =============================================================================
// SHARED — with input sanitization
// =============================================================================

const uuidSchema = z.string().uuid("Invalid UUID format");

// Phone: Indian format only, sanitized
const phoneSchema = z
  .string()
  .regex(/^[6-9]\d{9}$/, "Invalid Indian phone number")
  .transform((val) => val.replace(/\D/g, "")); // Remove non-digits

// Pincode: 6 digits only
const pincodeSchema = z
  .string()
  .regex(/^[1-9][0-9]{5}$/, "Invalid pincode")
  .transform((val) => val.slice(0, 6));

// Name: prevent XSS, limit length
const nameSchema = z
  .string()
  .min(1, "Name is required")
  .max(100, "Name too long")
  .regex(/^[a-zA-Z\s\-'.]+$/, "Name contains invalid characters");

// Address: allow letters, numbers, spaces, commas, hyphens
const addressSchema = z
  .string()
  .min(1, "Address required")
  .max(500, "Address too long")
  .regex(/^[a-zA-Z0-9\s\-',.#/]+$/, "Address contains invalid characters");

// =============================================================================
// CREATE ORDER (with rate limit considerations)
// =============================================================================

export const createOrderSchema = z
  .object({
    school_id: uuidSchema,
    order_type: z.enum(["BLANK", "PRE_DETAILS"]),
    card_count: z
      .number()
      .int("Card count must be integer")
      .min(1, "Minimum 1 card")
      .max(1500, "Maximum 1500 cards per order"),

    items: z
      .array(
        z.object({
          student_id: uuidSchema.optional(),
          student_name: nameSchema,
          class: z.string().max(50).optional(),
          section: z.string().max(50).optional(),
          roll_number: z.string().max(50).optional(),
          photo_url: z.string().url("Invalid photo URL").optional(),
        }),
      )
      .optional(),

    delivery_address: z
      .object({
        name: nameSchema,
        phone: phoneSchema,
        address: addressSchema,
        city: nameSchema,
        state: nameSchema,
        pincode: pincodeSchema,
      })
      .optional(),

    notes: z.string().max(500, "Notes too long").optional(),
  })
  .strict()
  .superRefine((data, ctx) => {
    if (data.order_type === "PRE_DETAILS") {
      if (!data.items || data.items.length === 0) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          message: "Items are required for PRE_DETAILS orders",
          path: ["items"],
        });
      }
      if (data.items && data.items.length !== data.card_count) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          message: `Items count (${data.items.length}) must match card_count (${data.card_count})`,
          path: ["items"],
        });
      }
    }
    if (data.order_type === "BLANK" && data.items && data.items.length > 0) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: "BLANK orders must not include items",
        path: ["items"],
      });
    }
  });

// =============================================================================
// CONFIRM ORDER
// =============================================================================

export const confirmOrderSchema = z
  .object({
    note: z.string().max(500).optional(),
  })
  .strict();

// =============================================================================
// PAYMENT (with amount validation)
// =============================================================================

export const paymentSchema = z
  .object({
    amount_received: z
      .number()
      .positive("Amount must be greater than 0")
      .max(100000000, "Amount exceeds limit"), // Max ₹10,00,000
    payment_mode: z.enum([
      "UPI",
      "BANK_TRANSFER",
      "CHEQUE",
      "RAZORPAY",
      "CASH",
    ]),
    payment_ref: z
      .string()
      .min(1, "Payment reference required")
      .max(100, "Reference too long")
      .regex(/^[a-zA-Z0-9\-_]+$/, "Invalid reference format"),
    note: z.string().max(500).optional(),
  })
  .strict();

// =============================================================================
// VENDOR ASSIGNMENT
// =============================================================================

export const assignVendorSchema = z
  .object({
    vendor_id: uuidSchema,
    vendor_notes: z.string().max(500).optional(),
    note: z.string().max(500).optional(),
  })
  .strict();

// =============================================================================
// PRINTING STATUS
// =============================================================================

export const printingStatusSchema = z
  .object({
    status: z.enum(["STARTED", "COMPLETED"]),
    note: z.string().max(500).optional(),
  })
  .strict();

// =============================================================================
// SHIPMENT
// =============================================================================

export const createShipmentSchema = z
  .object({
    awb_code: z
      .string()
      .min(1, "AWB code required")
      .max(100)
      .regex(/^[a-zA-Z0-9\-_]+$/, "Invalid AWB format"),
    courier_name: z.string().min(1).max(100),
    tracking_url: z.string().url("Invalid tracking URL").optional(),
    notes: z.string().max(500).optional(),
  })
  .strict();

export const markShippedSchema = z
  .object({
    note: z.string().max(500).optional(),
  })
  .strict();

// =============================================================================
// DELIVERY
// =============================================================================

export const deliverySchema = z
  .object({
    note: z.string().max(500).optional(),
  })
  .strict();

// =============================================================================
// CANCEL ORDER
// =============================================================================

export const cancelOrderSchema = z
  .object({
    reason: z.string().min(1, "Cancellation reason required").max(500),
    notes: z.string().max(500).optional(),
  })
  .strict();

// =============================================================================
// LIST ORDERS (with pagination limits)
// =============================================================================

export const listOrdersSchema = z
  .object({
    // order.validation.js — listOrdersSchema
    status: z
      .enum([
        "PENDING",
        "CONFIRMED",
        "PAYMENT_PENDING",
        "ADVANCE_RECEIVED",
        "TOKEN_GENERATION", // ← ADD
        "TOKEN_GENERATED",
        "CARD_DESIGN", // ← ADD
        "CARD_DESIGN_READY",
        "SENT_TO_VENDOR", // ← ADD
        "PRINTING",
        "PRINT_COMPLETE", // ← ADD
        "READY_TO_SHIP", // ← ADD
        "SHIPPED",
        "OUT_FOR_DELIVERY", // ← ADD
        "DELIVERED",
        "BALANCE_PENDING", // ← ADD
        "COMPLETED",
        "CANCELLED",
        "FAILED",
        "REFUNDED", // ← ADD
      ])
      .optional(),

    school_id: uuidSchema.optional(),

    from_date: z.string().datetime().optional(),
    to_date: z.string().datetime().optional(),

    limit: z
      .string()
      .regex(/^\d+$/)
      .transform(Number)
      .pipe(z.number().int().min(1).max(100))
      .optional(),

    offset: z
      .string()
      .regex(/^\d+$/)
      .transform(Number)
      .pipe(z.number().int().min(0))
      .optional(),
  })
  .strict()
  .refine(
    (data) => {
      if (data.from_date && data.to_date) {
        return new Date(data.from_date) <= new Date(data.to_date);
      }
      return true;
    },
    {
      message: "from_date cannot be greater than to_date",
      path: ["from_date"],
    },
  );
