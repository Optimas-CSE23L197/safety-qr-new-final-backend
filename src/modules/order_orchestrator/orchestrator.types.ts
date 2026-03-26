// =============================================================================
// orchestrator.types.ts
// TypeScript definitions for the orchestrator module.
// =============================================================================

export type OrchestratorState =
  | "CREATED"
  | "PENDING_APPROVAL"
  | "APPROVED"
  | "ADVANCE_PENDING"
  | "ADVANCE_PAID"
  | "TOKEN_GENERATED"
  | "CARD_GENERATED"
  | "DESIGN_DONE"
  | "VENDOR_ASSIGNED"
  | "PRINTING"
  | "SHIPPED"
  | "DELIVERED"
  | "COMPLETED"
  | "CANCELLED"
  | "FAILED";

export type PipelineStep =
  | "CREATE"
  | "CONFIRM"
  | "ADVANCE_INVOICE"
  | "ADVANCE_PAYMENT"
  | "TOKEN_GENERATION"
  | "CARD_DESIGN"
  | "VENDOR_DISPATCH"
  | "PRINTING_START"
  | "PRINTING_DONE"
  | "SHIPMENT_CREATE"
  | "SHIPMENT_SHIPPED"
  | "DELIVERY"
  | "BALANCE_INVOICE"
  | "BALANCE_PAYMENT"
  | "CANCEL"
  | "REFUND";

export type OrderEvent =
  | "ORDER_CREATED"
  | "ORDER_APPROVED"
  | "ADVANCE_PAYMENT_REQUESTED"
  | "ADVANCE_PAYMENT_RECEIVED"
  | "TOKEN_GENERATED"
  | "CARD_GENERATED"
  | "DESIGN_COMPLETED"
  | "VENDOR_ASSIGNED"
  | "PRINTING_STARTED"
  | "SHIPPED"
  | "DELIVERED"
  | "ORDER_COMPLETED"
  | "ORDER_CANCELLED"
  | "STEP_FAILED";

export type Actor = {
  id: string;
  role: "SUPER_ADMIN" | "SCHOOL_ADMIN" | "SYSTEM";
  schoolId?: string;
};

export type PaymentData = {
  amount: number;
  reference: string;
  provider: string;
  providerRef?: string;
  paymentMode?: string;
  notes?: string;
};

export type CancellationMeta = {
  reason: string;
  notes?: string;
};

export type OrderStatusResponse = {
  orderId: string;
  state: OrchestratorState;
  dbStatus: string | null;
  paymentStatus: string | null;
  pipeline: {
    current_step: string;
    overall_progress: number;
    is_stalled: boolean;
    stalled_at: Date | null;
    stalled_reason: string | null;
    started_at: Date;
    completed_at: Date | null;
  } | null;
  milestones: {
    advancePaid: Date | null;
    tokensGenerated: Date | null;
    printComplete: Date | null;
    balancePaid: Date | null;
  };
  shipment: {
    status: string;
    awb_code: string | null;
    courier_name: string | null;
    tracking_url: string | null;
    delivered_at: Date | null;
  } | null;
};

export type StepExecutionResult = {
  success: boolean;
  stepExecutionId: string;
  result?: any;
  error?: string;
};

export type WorkerJobData = {
  orderId: string;
  event?: OrderEvent;
  stepExecutionId?: string;
  jobExecutionId?: string;
  payload?: any;
};

export type IdempotencyResult = {
  claimed: boolean;
  existing?: string;
};

export type GuardResult = {
  pass: boolean;
  reason?: string;
  order?: any;
};

export type RetryPolicy = {
  attempts: number;
  backoff: {
    type: "exponential" | "fixed";
    delay: number;
  };
};

export type NotificationTemplate = {
  email?: {
    subject: string;
    body: string;
  };
  sms?: string;
  push?: string;
};
