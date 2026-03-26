// =============================================================================
// notifications/notification.events.js
// Event definitions and templates for all notification types.
// =============================================================================

export const NOTIFICATION_EVENTS = {
  // Order notifications
  ORDER_CREATED: "ORDER_CREATED",
  ORDER_APPROVED: "ORDER_APPROVED",
  ORDER_PENDING_APPROVAL: "ORDER_PENDING_APPROVAL",
  ORDER_COMPLETED: "ORDER_COMPLETED",
  ORDER_CANCELLED: "ORDER_CANCELLED",

  // Payment notifications
  ADVANCE_INVOICE_READY: "ADVANCE_INVOICE_READY",
  BALANCE_INVOICE_READY: "BALANCE_INVOICE_READY",
  ADVANCE_PAYMENT_RECEIVED: "ADVANCE_PAYMENT_RECEIVED",
  BALANCE_PAYMENT_RECEIVED: "BALANCE_PAYMENT_RECEIVED",
  PAYMENT_OVERDUE: "PAYMENT_OVERDUE",
  PAYMENT_FAILED: "PAYMENT_FAILED",

  // Production notifications
  TOKENS_GENERATED: "TOKENS_GENERATED",
  CARD_DESIGN_READY: "CARD_DESIGN_READY",
  PRINTING_STARTED: "PRINTING_STARTED",
  PRINTING_COMPLETED: "PRINTING_COMPLETED",

  // Shipping notifications
  SHIPMENT_CREATED: "SHIPMENT_CREATED",
  SHIPMENT_SHIPPED: "SHIPMENT_SHIPPED",
  SHIPMENT_OUT_FOR_DELIVERY: "SHIPMENT_OUT_FOR_DELIVERY",
  ORDER_DELIVERED: "ORDER_DELIVERED",
  DELIVERY_FAILED: "DELIVERY_FAILED",

  // Vendor notifications
  VENDOR_ASSIGNED: "VENDOR_ASSIGNED",
  VENDOR_ORDER_CANCELLED: "VENDOR_ORDER_CANCELLED",
  VENDOR_PRINTING_REQUEST: "VENDOR_PRINTING_REQUEST",

  // Admin notifications
  STEP_FAILURE_ESCALATED: "STEP_FAILURE_ESCALATED",
  DLQ_ALERT: "DLQ_ALERT",
  STALLED_PIPELINE: "STALLED_PIPELINE",

  // Security notifications
  ANOMALY_DETECTED: "ANOMALY_DETECTED",
  SUSPICIOUS_ACTIVITY: "SUSPICIOUS_ACTIVITY",
};

export const NOTIFICATION_TEMPLATES = {
  [NOTIFICATION_EVENTS.ORDER_CREATED]: {
    email: {
      subject: "Order Created - #{orderNumber}",
      body: `Dear #{schoolName},
      
Your order #{orderNumber} has been created successfully and is pending approval.

Order Details:
- Order ID: #{orderNumber}
- Type: #{orderType}
- Cards: #{cardCount}
- Created: #{createdAt}

You will be notified once the order is approved.

Thank you,
ResQID Team`,
    },
    sms: "ResQID: Order #{orderNumber} created and pending approval. #{cardCount} cards.",
    push: {
      title: "Order Created",
      body: "Order #{orderNumber} created and pending approval",
    },
  },

  [NOTIFICATION_EVENTS.ORDER_APPROVED]: {
    email: {
      subject: "Order Approved - #{orderNumber}",
      body: `Dear #{schoolName},

Great news! Your order #{orderNumber} has been approved and is now processing.

Next Steps:
1. Advance payment invoice has been generated
2. Please make the payment to proceed with production

Order Details:
- Order ID: #{orderNumber}
- Type: #{orderType}
- Cards: #{cardCount}
- Approved By: #{approvedBy}
- Approved At: #{approvedAt}

Thank you,
ResQID Team`,
    },
    sms: "ResQID: Order #{orderNumber} approved. Advance invoice ready.",
    push: {
      title: "Order Approved",
      body: "Order #{orderNumber} approved. Advance invoice ready.",
    },
  },

  [NOTIFICATION_EVENTS.ORDER_PENDING_APPROVAL]: {
    email: {
      subject: "URGENT: Order Pending Approval - #{orderNumber}",
      body: `⚠️ SUPER ADMIN ALERT ⚠️

Order #{orderNumber} requires your approval.

Order Details:
- School: #{schoolName}
- Order Type: #{orderType}
- Cards: #{cardCount}
- Channel: #{channel}
- Created At: #{createdAt}

Please review and approve/reject this order.

ResQID System`,
    },
    sms: "URGENT: Order #{orderNumber} pending approval for #{schoolName}.",
  },

  [NOTIFICATION_EVENTS.ADVANCE_INVOICE_READY]: {
    email: {
      subject: "Advance Payment Invoice Ready - Order #{orderNumber}",
      body: `Dear #{schoolName},

The advance payment invoice for your order #{orderNumber} is ready.

Invoice Details:
- Invoice Number: #{invoiceNumber}
- Amount: ₹#{amount}
- Due Date: #{dueDate}
- Order Number: #{orderNumber}

Please make the payment by the due date to avoid delays in production.

You can view and download the invoice from your dashboard.

Thank you,
ResQID Team`,
    },
    sms: "ResQID: Advance invoice #{invoiceNumber} of ₹#{amount} ready for order #{orderNumber}. Due: #{dueDate}",
    push: {
      title: "Advance Invoice Ready",
      body: "Invoice #{invoiceNumber} of ₹#{amount} ready for order #{orderNumber}",
    },
  },

  [NOTIFICATION_EVENTS.BALANCE_INVOICE_READY]: {
    email: {
      subject: "Balance Payment Invoice Ready - Order #{orderNumber}",
      body: `Dear #{schoolName},

The balance payment invoice for your order #{orderNumber} is ready.

Invoice Details:
- Invoice Number: #{invoiceNumber}
- Amount: ₹#{amount}
- Due Date: #{dueDate}
- Order Number: #{orderNumber}

Your order has been delivered. Please make the balance payment by the due date.

Thank you,
ResQID Team`,
    },
    sms: "ResQID: Balance invoice #{invoiceNumber} of ₹#{amount} ready for order #{orderNumber}. Due: #{dueDate}",
    push: {
      title: "Balance Invoice Ready",
      body: "Balance invoice #{invoiceNumber} of ₹#{amount} ready for order #{orderNumber}",
    },
  },

  [NOTIFICATION_EVENTS.ADVANCE_PAYMENT_RECEIVED]: {
    email: {
      subject: "Advance Payment Received - Order #{orderNumber}",
      body: `Dear #{schoolName},

We have received your advance payment for order #{orderNumber}.

Payment Details:
- Amount: ₹#{amount}
- Reference: #{reference}
- Received At: #{receivedAt}

Production will now begin. You will be notified when tokens are generated.

Thank you,
ResQID Team`,
    },
    sms: "ResQID: Advance payment of ₹#{amount} received for order #{orderNumber}. Ref: #{reference}",
    push: {
      title: "Payment Received",
      body: "Advance payment of ₹#{amount} received for order #{orderNumber}",
    },
  },

  [NOTIFICATION_EVENTS.BALANCE_PAYMENT_RECEIVED]: {
    email: {
      subject: "Balance Payment Received - Order #{orderNumber}",
      body: `Dear #{schoolName},

Thank you! We have received the balance payment for order #{orderNumber}.

Payment Details:
- Amount: ₹#{amount}
- Reference: #{reference}
- Received At: #{receivedAt}

Your order is now fully paid and marked as completed.

Thank you for choosing ResQID!`,
    },
    sms: "ResQID: Balance payment of ₹#{amount} received for order #{orderNumber}. Order completed!",
    push: {
      title: "Order Completed",
      body: "Order #{orderNumber} is now fully paid and completed",
    },
  },

  [NOTIFICATION_EVENTS.TOKENS_GENERATED]: {
    email: {
      subject: "Tokens Generated - Order #{orderNumber}",
      body: `Dear #{schoolName},

Tokens have been successfully generated for your order #{orderNumber}.

Generation Details:
- Total Tokens: #{totalTokens}
- Generated: #{generatedTokens}
- Failed: #{failedTokens}
- Batch ID: #{batchId}

You can now download the QR codes and begin assigning tokens to students.

Thank you,
ResQID Team`,
    },
    sms: "ResQID: #{generatedTokens} tokens generated for order #{orderNumber}.",
  },

  [NOTIFICATION_EVENTS.PRINTING_STARTED]: {
    email: {
      subject: "Printing Started - Order #{orderNumber}",
      body: `Dear #{schoolName},

Your cards are now being printed!

Printing Details:
- Vendor: #{vendorName}
- Cards Printing: #{cardCount}
- Expected Completion: #{expectedDays} days

You will receive tracking information once the cards are shipped.

Thank you,
ResQID Team`,
    },
    sms: "ResQID: Printing started for order #{orderNumber}. Expected: #{expectedDays} days.",
    push: {
      title: "Printing Started",
      body: "Your cards for order #{orderNumber} are now being printed",
    },
  },

  [NOTIFICATION_EVENTS.PRINTING_COMPLETED]: {
    email: {
      subject: "Printing Completed - Order #{orderNumber}",
      body: `Dear #{schoolName},

Printing for your order #{orderNumber} has been completed!

Printing Details:
- Total Cards: #{cardCount}
- Completed At: #{completedAt}
- Vendor: #{vendorName}

Your order is now being prepared for shipment. Tracking details will follow soon.

Thank you,
ResQID Team`,
    },
    sms: "ResQID: Printing completed for order #{orderNumber}. Preparing for shipment.",
  },

  [NOTIFICATION_EVENTS.SHIPMENT_CREATED]: {
    email: {
      subject: "Order Shipped - #{orderNumber}",
      body: `Dear #{schoolName},

Your order #{orderNumber} has been shipped!

Tracking Details:
- AWB Number: #{awbCode}
- Courier: #{courierName}
- Tracking URL: #{trackingUrl}
- Estimated Delivery: #{estimatedDelivery}

You can track your shipment using the link above.

Thank you,
ResQID Team`,
    },
    sms: "ResQID: Order #{orderNumber} shipped. Track: #{trackingUrl}",
    push: {
      title: "Order Shipped",
      body: "Your order #{orderNumber} has been shipped. Track: #{trackingUrl}",
    },
  },

  [NOTIFICATION_EVENTS.ORDER_DELIVERED]: {
    email: {
      subject: "Order Delivered - #{orderNumber}",
      body: `Dear #{schoolName},

Your order #{orderNumber} has been delivered!

Delivery Details:
- Delivered At: #{deliveredAt}
- AWB Number: #{awbCode}
- Received By: #{receivedBy}

Please verify the contents and let us know if there are any issues.

Thank you for choosing ResQID!`,
    },
    sms: "ResQID: Order #{orderNumber} delivered. Thank you!",
    push: {
      title: "Order Delivered",
      body: "Your order #{orderNumber} has been delivered",
    },
  },

  [NOTIFICATION_EVENTS.ORDER_COMPLETED]: {
    email: {
      subject: "Order Completed - #{orderNumber}",
      body: `Dear #{schoolName},

Your order #{orderNumber} has been successfully completed!

Summary:
- Order ID: #{orderNumber}
- Total Cards: #{cardCount}
- Completed At: #{completedAt}
- Total Amount: ₹#{totalAmount}

Thank you for choosing ResQID. We look forward to serving you again!

Best regards,
ResQID Team`,
    },
    sms: "ResQID: Order #{orderNumber} completed! Thank you for choosing ResQID.",
    push: {
      title: "Order Completed",
      body: "Order #{orderNumber} completed successfully",
    },
  },

  [NOTIFICATION_EVENTS.ORDER_CANCELLED]: {
    email: {
      subject: "Order Cancelled - #{orderNumber}",
      body: `Dear #{schoolName},

Your order #{orderNumber} has been cancelled.

Cancellation Details:
- Reason: #{reason}
- Cancelled At: #{cancelledAt}
- Cancelled By: #{cancelledBy}

If you have any questions, please contact support.

ResQID Team`,
    },
    sms: "ResQID: Order #{orderNumber} cancelled. Reason: #{reason}",
    push: {
      title: "Order Cancelled",
      body: "Your order #{orderNumber} has been cancelled",
    },
  },

  [NOTIFICATION_EVENTS.STEP_FAILURE_ESCALATED]: {
    email: {
      subject: "URGENT: Pipeline Step Failure - Order #{orderNumber}",
      body: `⚠️ URGENT - SUPER ADMIN ALERT ⚠️

An order pipeline step has failed and requires immediate attention.

Order Details:
- Order ID: #{orderNumber}
- School: #{schoolId}
- Failed Step: #{step}
- Error: #{error}
- Retry Count: #{retryCount}

Please investigate and resolve this issue immediately.

ResQID System`,
    },
    sms: "URGENT: Order #{orderNumber} failed at step #{step}. Check dashboard.",
  },

  [NOTIFICATION_EVENTS.DLQ_ALERT]: {
    email: {
      subject: "DLQ Alert - Job Failed: #{jobType}",
      body: `⚠️ SUPER ADMIN ALERT ⚠️

A job has been sent to the Dead Letter Queue and requires manual intervention.

Job Details:
- Job Type: #{jobType}
- Order ID: #{orderId}
- Error: #{error}
- DLQ ID: #{dlqId}
- Timestamp: #{timestamp}

Please review the DLQ and resolve the issue.

ResQID System`,
    },
    sms: "DLQ Alert: Job #{jobType} failed for order #{orderId}. Check dashboard.",
  },

  [NOTIFICATION_EVENTS.VENDOR_ASSIGNED]: {
    email: {
      subject: "New Order Assigned - #{orderNumber}",
      body: `Dear #{vendorName},

A new order has been assigned to you for printing.

Order Details:
- Order Number: #{orderNumber}
- School: #{schoolName}
- Cards to Print: #{cardCount}
- Delivery Address: #{deliveryAddress}
- Design Files: #{designFiles}

Please process this order at your earliest convenience.

ResQID Team`,
    },
    sms: "ResQID: New order #{orderNumber} assigned. #{cardCount} cards to print.",
  },

  [NOTIFICATION_EVENTS.ANOMALY_DETECTED]: {
    email: {
      subject: "Security Alert: Anomaly Detected",
      body: `⚠️ SECURITY ALERT ⚠️

An anomaly has been detected on a token.

Details:
- Token ID: #{tokenId}
- Student: #{studentName}
- Anomaly Type: #{anomalyType}
- Severity: #{severity}
- Time: #{detectedAt}
- IP: #{ipAddress}
- Location: #{location}

Please investigate immediately.

ResQID Security System`,
    },
    sms: "⚠️ Security Alert: Anomaly detected on token for #{studentName}",
    push: {
      title: "Security Alert",
      body: "Anomaly detected on your child's card",
    },
  },

  [NOTIFICATION_EVENTS.STALLED_PIPELINE]: {
    email: {
      subject: "Stalled Pipeline Detected - Order #{orderNumber}",
      body: `⚠️ SUPER ADMIN ALERT ⚠️

An order pipeline has been stalled for over 30 minutes.

Order Details:
- Order ID: #{orderNumber}
- School: #{schoolName}
- Current Step: #{currentStep}
- Stalled Since: #{stalledAt}
- Reason: #{stalledReason}

Please investigate and resume the pipeline.

ResQID System`,
    },
    sms: "Alert: Pipeline stalled for order #{orderNumber} at step #{currentStep}",
  },
};
