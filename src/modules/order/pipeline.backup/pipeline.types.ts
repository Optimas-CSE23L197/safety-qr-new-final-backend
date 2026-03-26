// =============================================================================
// pipeline.types.ts — RESQID
// TypeScript types for the Pipeline Dashboard frontend.
// These mirror the JSON shapes returned by the pipeline API.
// =============================================================================

// ─────────────────────────────────────────────────────────────────────────────
// ENUMS (keep in sync with Prisma schema)
// ─────────────────────────────────────────────────────────────────────────────

export type PipelineStepName =
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
  | "BALANCE_PAYMENT";

export type StepStatus =
  | "PENDING"
  | "RUNNING"
  | "COMPLETED"
  | "FAILED"
  | "PARTIAL_FAILED"
  | "SKIPPED";
export type JobStatus =
  | "QUEUED"
  | "RUNNING"
  | "COMPLETED"
  | "FAILED"
  | "RETRYING"
  | "DEAD";

// ─────────────────────────────────────────────────────────────────────────────
// SUPER ADMIN DASHBOARD PAYLOAD
// Returned by GET /api/orders/:id/pipeline-status
// ─────────────────────────────────────────────────────────────────────────────

export interface OrderPipelineDashboard {
  order: {
    id: string;
    orderNumber: string;
    status: string;
    cardCount: number;
    orderType: "BLANK" | "PRE_DETAILS";
    channel: "DASHBOARD" | "CALL";
    school: { id: string; name: string; code: string };
    createdAt: string;
  };

  pipeline: {
    id: string;
    currentStep: PipelineStepName;
    currentStepLabel: string;
    overallProgress: number; // 0–100
    isStalled: boolean;
    stalledAt: string | null;
    stalledReason: string | null;
  } | null;

  // Ordered list for the vertical timeline UI
  timeline: TimelineEntry[];

  // Detail for the currently running step
  activeStep: ActiveStepDetail | null;

  // Token generation specific counters
  tokenGeneration: TokenGenerationDetail | null;

  queueHealth: {
    tokenGeneration: QueueStats;
    cardDesign: QueueStats;
  };

  // Tail of the step log (last 50 lines)
  logs: LogLine[];
}

export interface TimelineEntry {
  step: PipelineStepName;
  label: string;
  isAsync: boolean;
  status: StepStatus;
  progress: number; // 0–100
  attemptNumber: number | null;
  startedAt: string | null;
  completedAt: string | null;
  durationMs: number | null;
  hasError: boolean;
  resultSummary: Record<string, unknown> | null;
}

export interface ActiveStepDetail {
  step: PipelineStepName;
  label: string;
  isAsync: boolean;
  progress: number;
  progressDetail: {
    processed: number;
    total: number;
    failed: number;
    phase: string;
  } | null;
  startedAt: string;
  elapsedMs: number;
  jobs: {
    total: number;
    queued: number;
    running: number;
    completed: number;
    failed: number;
    avgProgress: number;
  } | null;
}

export interface TokenGenerationDetail {
  batchId: string;
  batchStatus: "PENDING" | "PROCESSING" | "COMPLETE" | "PARTIAL" | "FAILED";
  total: number;
  generated: number;
  failed: number;
  completedAt: string | null;
  pct: number;
  failedTokenIds: string[];
}

export interface QueueStats {
  name: string;
  active: number;
  waiting: number;
  failed: number;
  completed: number;
  delayed: number;
}

export interface LogLine {
  level: "info" | "warn" | "error";
  message: string;
  context: Record<string, unknown> | null;
  at: string;
}

// ─────────────────────────────────────────────────────────────────────────────
// SCHOOL ADMIN VIEW
// Returned by GET /api/orders/:id/progress (school admin role)
// ─────────────────────────────────────────────────────────────────────────────

export interface SchoolAdminProgressView {
  orderNumber: string;
  cardCount: number;
  paymentStatus: string;
  overallProgress: number;
  phases: Phase[];
  shipment: {
    status: string;
    courier: string | null;
    trackingUrl: string | null;
    awbCode: string | null;
    deliveredAt: string | null;
  } | null;
}

export interface Phase {
  id: number;
  name: string;
  label: string;
  status: "COMPLETED" | "ACTIVE" | "PENDING";
}

// ─────────────────────────────────────────────────────────────────────────────
// SSE EVENTS (from GET /api/orders/:id/progress/stream)
// ─────────────────────────────────────────────────────────────────────────────

export type SSEEvent =
  | {
      type: "connected";
      orderId: string;
      pipeline: OrderPipelineDashboard["pipeline"];
    }
  | {
      type: "progress";
      step: PipelineStepName;
      pct: number;
      processed: number;
      total: number;
      failed: number;
      phase: string;
    }
  | {
      type: "progress";
      step: PipelineStepName;
      status: "STALLED";
      elapsedMs: number;
      message: string;
    }
  | {
      type: "progress";
      step: PipelineStepName;
      status: "FAILED" | "RETRYING";
      error: string;
      attempt: number;
    }
  | {
      type: "progress";
      step: PipelineStepName;
      status: "COMPLETED" | "PARTIAL_FAILED";
      pct: 100;
      tokenCount: number;
      failedCount: number;
    }
  | { type: "done"; orderId: string; status: "COMPLETED" | "FAILED" };

// ─────────────────────────────────────────────────────────────────────────────
// API RESPONSES
// ─────────────────────────────────────────────────────────────────────────────

// POST /api/orders/:id/generate  (step 4 trigger)
export interface GenerateTokensResponse {
  batchId: string;
  jobExecutionId: string;
  bullJobId: string;
  status: "QUEUED";
  cardCount: number;
  pollUrl: string;
  message: string;
}

// POST /api/orders/:id/retry-step
export interface RetryStepResponse {
  stepExecutionId: string;
  jobExecutionId: string;
  batchId?: string;
  existingTokens?: number;
  remainingTokens?: number;
  message: string;
}
