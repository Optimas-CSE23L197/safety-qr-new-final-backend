-- CreateEnum
CREATE TYPE "UserStatus" AS ENUM ('ACTIVE', 'SUSPENDED', 'DELETED');

-- CreateEnum
CREATE TYPE "AppTheme" AS ENUM ('LIGHT', 'DARK', 'SYSTEM');

-- CreateEnum
CREATE TYPE "ProfileType" AS ENUM ('STUDENT', 'ELDERLY', 'PET', 'INDIVIDUAL');

-- CreateEnum
CREATE TYPE "SetupStage" AS ENUM ('PENDING', 'BASIC', 'COMPLETE', 'VERIFIED');

-- CreateEnum
CREATE TYPE "Gender" AS ENUM ('MALE', 'FEMALE', 'OTHER', 'PREFER_NOT_TO_SAY');

-- CreateEnum
CREATE TYPE "BloodGroup" AS ENUM ('A_POS', 'A_NEG', 'B_POS', 'B_NEG', 'AB_POS', 'AB_NEG', 'O_POS', 'O_NEG', 'UNKNOWN');

-- CreateEnum
CREATE TYPE "TokenStatus" AS ENUM ('UNASSIGNED', 'ISSUED', 'ACTIVE', 'INACTIVE', 'REVOKED', 'EXPIRED');

-- CreateEnum
CREATE TYPE "SchoolRole" AS ENUM ('ADMIN', 'STAFF', 'VIEWER');

-- CreateEnum
CREATE TYPE "ScanResult" AS ENUM ('SUCCESS', 'INVALID', 'REVOKED', 'EXPIRED', 'INACTIVE', 'RATE_LIMITED', 'ERROR');

-- CreateEnum
CREATE TYPE "AnomalyType" AS ENUM ('HIGH_FREQUENCY', 'MULTIPLE_LOCATIONS', 'SUSPICIOUS_IP', 'AFTER_HOURS', 'BULK_SCRAPING', 'HONEYPOT_TRIGGERED', 'REPEATED_FAILURE');

-- CreateEnum
CREATE TYPE "AnomalySeverity" AS ENUM ('LOW', 'MEDIUM', 'HIGH', 'CRITICAL');

-- CreateEnum
CREATE TYPE "SubscriptionStatus" AS ENUM ('TRIALING', 'ACTIVE', 'PAST_DUE', 'CANCELED', 'EXPIRED');

-- CreateEnum
CREATE TYPE "PlanType" AS ENUM ('FREE_PILOT', 'GOVT_STANDARD', 'PRIVATE_STANDARD', 'ENTERPRISE');

-- CreateEnum
CREATE TYPE "PaymentStatus" AS ENUM ('PENDING', 'SUCCESS', 'FAILED', 'REFUNDED');

-- CreateEnum
CREATE TYPE "OrderPaymentStatus" AS ENUM ('UNPAID', 'PARTIALLY_PAID', 'PAID', 'REFUNDED');

-- CreateEnum
CREATE TYPE "InvoiceStatus" AS ENUM ('DRAFT', 'ISSUED', 'PAID', 'OVERDUE', 'CANCELLED');

-- CreateEnum
CREATE TYPE "OrderType" AS ENUM ('BLANK', 'PRE_DETAILS');

-- CreateEnum
CREATE TYPE "OrderMode" AS ENUM ('BULK', 'SINGLE');

-- CreateEnum
CREATE TYPE "OrderChannel" AS ENUM ('DASHBOARD', 'CALL');

-- CreateEnum
CREATE TYPE "OrderStatus" AS ENUM ('PENDING', 'CONFIRMED', 'PAYMENT_PENDING', 'ADVANCE_RECEIVED', 'TOKEN_GENERATION', 'TOKEN_GENERATED', 'CARD_DESIGN', 'CARD_DESIGN_READY', 'CARD_DESIGN_REVISION', 'SENT_TO_VENDOR', 'PRINTING', 'PRINT_COMPLETE', 'READY_TO_SHIP', 'SHIPPED', 'OUT_FOR_DELIVERY', 'DELIVERED', 'BALANCE_PENDING', 'COMPLETED', 'CANCELLED', 'REFUNDED');

-- CreateEnum
CREATE TYPE "OrderItemStatus" AS ENUM ('PENDING', 'TOKEN_GENERATED', 'CARD_DESIGNED', 'PRINTED', 'SHIPPED', 'DELIVERED');

-- CreateEnum
CREATE TYPE "ShipmentStatus" AS ENUM ('PENDING', 'PICKUP_SCHEDULED', 'PICKED_UP', 'IN_TRANSIT', 'OUT_FOR_DELIVERY', 'DELIVERED', 'FAILED', 'RETURNED');

-- CreateEnum
CREATE TYPE "TokenBatchStatus" AS ENUM ('PENDING', 'PROCESSING', 'COMPLETE', 'PARTIAL', 'FAILED');

-- CreateEnum
CREATE TYPE "SchoolType" AS ENUM ('GOVERNMENT', 'PRIVATE', 'INTERNATIONAL', 'NGO');

-- CreateEnum
CREATE TYPE "PricingTier" AS ENUM ('GOVT_STANDARD', 'PRIVATE_STANDARD', 'ENTERPRISE', 'FREE_PILOT');

-- CreateEnum
CREATE TYPE "InvoiceType" AS ENUM ('ADVANCE', 'BALANCE', 'RENEWAL', 'CUSTOM');

-- CreateEnum
CREATE TYPE "PaymentMode" AS ENUM ('BANK_TRANSFER', 'UPI', 'CHEQUE', 'RAZORPAY', 'CASH');

-- CreateEnum
CREATE TYPE "BatchPaymentStatus" AS ENUM ('PENDING', 'PARTIALLY_PAID', 'PAID', 'OVERDUE', 'CANCELLED');

-- CreateEnum
CREATE TYPE "VendorStatus" AS ENUM ('ACTIVE', 'INACTIVE', 'BLACKLISTED');

-- CreateEnum
CREATE TYPE "ShiprocketStatus" AS ENUM ('PENDING', 'PICKUP_SCHEDULED', 'PICKED_UP', 'IN_TRANSIT', 'OUT_FOR_DELIVERY', 'DELIVERED', 'UNDELIVERED', 'CANCELLED', 'RTO_INITIATED', 'RTO_DELIVERED');

-- CreateEnum
CREATE TYPE "PrintStatus" AS ENUM ('PENDING', 'PRINTED', 'REPRINTED', 'FAILED');

-- CreateEnum
CREATE TYPE "QrFormat" AS ENUM ('PNG', 'SVG', 'PDF');

-- CreateEnum
CREATE TYPE "QrType" AS ENUM ('BLANK', 'PRE_DETAILS');

-- CreateEnum
CREATE TYPE "NotificationType" AS ENUM ('SCAN_ALERT', 'SCAN_ANOMALY', 'CARD_EXPIRING', 'CARD_REVOKED', 'CARD_REPLACED', 'BILLING_ALERT', 'DEVICE_LOGIN', 'SYSTEM');

-- CreateEnum
CREATE TYPE "NotificationChannel" AS ENUM ('SMS', 'EMAIL', 'PUSH');

-- CreateEnum
CREATE TYPE "NotificationStatus" AS ENUM ('QUEUED', 'SENT', 'FAILED', 'SUPPRESSED');

-- CreateEnum
CREATE TYPE "ActorType" AS ENUM ('SUPER_ADMIN', 'ADMIN', 'PARENT_USER', 'SYSTEM');

-- CreateEnum
CREATE TYPE "ProfileVisibility" AS ENUM ('PUBLIC', 'MINIMAL', 'HIDDEN');

-- CreateEnum
CREATE TYPE "LocationSource" AS ENUM ('SCAN_TRIGGER', 'PARENT_APP', 'MANUAL');

-- CreateEnum
CREATE TYPE "IpCaptureBasis" AS ENUM ('LEGITIMATE_INTEREST', 'CONSENT', 'LEGAL_OBLIGATION');

-- CreateEnum
CREATE TYPE "ParentEditType" AS ENUM ('EMERGENCY_CONTACTS', 'EMERGENCY_PROFILE', 'STUDENT_NAME', 'STUDENT_PHOTO', 'PARENT_PHONE', 'PARENT_EMAIL', 'CARD_VISIBILITY', 'CARD_BLOCK', 'CARD_REPLACEMENT', 'NOTIFICATION_PREFS');

-- CreateEnum
CREATE TYPE "OtpPurpose" AS ENUM ('LOGIN', 'PHONE_VERIFY', 'CARD_BLOCK', 'CARD_REPLACEMENT', 'EMAIL_VERIFY', 'DEVICE_CHANGE', 'CHANGE_PIN');

-- CreateEnum
CREATE TYPE "RateLimitIdentifierType" AS ENUM ('IP', 'DEVICE', 'TOKEN');

-- CreateEnum
CREATE TYPE "DevicePlatform" AS ENUM ('IOS', 'ANDROID', 'WEB');

-- CreateEnum
CREATE TYPE "DeviceLogoutReason" AS ENUM ('NEW_DEVICE_LOGIN', 'MANUAL_LOGOUT', 'SESSION_EXPIRED', 'ADMIN_REVOKED', 'SUSPICIOUS_ACTIVITY');

-- CreateEnum
CREATE TYPE "SessionRevokeReason" AS ENUM ('NEW_DEVICE_LOGIN', 'MANUAL_LOGOUT', 'SESSION_EXPIRED', 'ADMIN_REVOKED', 'PASSWORD_CHANGED', 'PHONE_CHANGED');

-- CreateTable
CREATE TABLE "School" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "address" TEXT,
    "city" TEXT,
    "state" TEXT,
    "pincode" TEXT,
    "country" TEXT NOT NULL DEFAULT 'IN',
    "code" TEXT NOT NULL,
    "serial_number" SERIAL NOT NULL,
    "email" TEXT,
    "phone" TEXT,
    "logo_url" TEXT,
    "timezone" TEXT NOT NULL DEFAULT 'Asia/Kolkata',
    "school_type" "SchoolType" NOT NULL DEFAULT 'PRIVATE',
    "pricing_tier" "PricingTier" NOT NULL DEFAULT 'PRIVATE_STANDARD',
    "udise_code" TEXT,
    "affiliation_num" TEXT,
    "affiliated_board" TEXT,
    "contract_signed_at" TIMESTAMP(3),
    "contract_expires_at" TIMESTAMP(3),
    "onboarded_by" TEXT,
    "onboarded_at" TIMESTAMP(3),
    "is_active" BOOLEAN NOT NULL DEFAULT true,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "School_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "SchoolSettings" (
    "id" TEXT NOT NULL,
    "school_id" TEXT NOT NULL,
    "allow_location" BOOLEAN NOT NULL DEFAULT false,
    "allow_parent_edit" BOOLEAN NOT NULL DEFAULT true,
    "scan_notifications_enabled" BOOLEAN NOT NULL DEFAULT true,
    "notify_on_every_scan" BOOLEAN NOT NULL DEFAULT false,
    "scan_alert_cooldown_mins" INTEGER NOT NULL DEFAULT 60,
    "token_validity_months" INTEGER NOT NULL DEFAULT 12,
    "max_tokens_per_student" INTEGER NOT NULL DEFAULT 1,
    "default_profile_visibility" "ProfileVisibility" NOT NULL DEFAULT 'PUBLIC',
    "renewal_reminder_days" INTEGER[] DEFAULT ARRAY[30, 15, 7, 1]::INTEGER[],
    "auto_deactivate_on_expiry" BOOLEAN NOT NULL DEFAULT true,
    "school_hours_start" TEXT NOT NULL DEFAULT '08:00',
    "school_hours_end" TEXT NOT NULL DEFAULT '17:00',
    "school_days" INTEGER[] DEFAULT ARRAY[1, 2, 3, 4, 5]::INTEGER[],
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "SchoolSettings_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "SchoolUser" (
    "id" TEXT NOT NULL,
    "school_id" TEXT NOT NULL,
    "email" TEXT NOT NULL,
    "password_hash" TEXT NOT NULL,
    "name" TEXT,
    "role" "SchoolRole" NOT NULL DEFAULT 'ADMIN',
    "is_active" BOOLEAN NOT NULL DEFAULT true,
    "last_login_at" TIMESTAMP(3),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "SchoolUser_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ParentUser" (
    "id" TEXT NOT NULL,
    "email" TEXT,
    "phone" TEXT NOT NULL,
    "phone_index" TEXT,
    "password_hash" TEXT,
    "name" TEXT,
    "avatar_url" TEXT,
    "preferred_language" TEXT NOT NULL DEFAULT 'en',
    "preferred_theme" "AppTheme" NOT NULL DEFAULT 'SYSTEM',
    "is_phone_verified" BOOLEAN NOT NULL DEFAULT false,
    "is_email_verified" BOOLEAN NOT NULL DEFAULT false,
    "status" "UserStatus" NOT NULL DEFAULT 'ACTIVE',
    "last_login_at" TIMESTAMP(3),
    "deleted_at" TIMESTAMP(3),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ParentUser_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ParentDevice" (
    "id" TEXT NOT NULL,
    "parent_id" TEXT NOT NULL,
    "device_token" TEXT NOT NULL,
    "platform" "DevicePlatform" NOT NULL,
    "device_name" TEXT,
    "device_model" TEXT,
    "os_version" TEXT,
    "app_version" TEXT,
    "is_active" BOOLEAN NOT NULL DEFAULT true,
    "last_seen_at" TIMESTAMP(3),
    "logged_out_at" TIMESTAMP(3),
    "logout_reason" "DeviceLogoutReason",
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ParentDevice_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ParentNotificationPref" (
    "id" TEXT NOT NULL,
    "parent_id" TEXT NOT NULL,
    "scan_notify_enabled" BOOLEAN NOT NULL DEFAULT true,
    "scan_notify_push" BOOLEAN NOT NULL DEFAULT true,
    "scan_notify_sms" BOOLEAN NOT NULL DEFAULT false,
    "scan_notify_email" BOOLEAN NOT NULL DEFAULT false,
    "anomaly_notify_enabled" BOOLEAN NOT NULL DEFAULT true,
    "anomaly_notify_push" BOOLEAN NOT NULL DEFAULT true,
    "anomaly_notify_sms" BOOLEAN NOT NULL DEFAULT true,
    "anomaly_notify_email" BOOLEAN NOT NULL DEFAULT true,
    "card_expiry_notify" BOOLEAN NOT NULL DEFAULT true,
    "card_blocked_notify" BOOLEAN NOT NULL DEFAULT true,
    "device_login_notify_email" BOOLEAN NOT NULL DEFAULT true,
    "account_change_notify" BOOLEAN NOT NULL DEFAULT true,
    "quiet_hours_enabled" BOOLEAN NOT NULL DEFAULT false,
    "quiet_hours_start" TEXT,
    "quiet_hours_end" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ParentNotificationPref_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "SuperAdmin" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "email" TEXT NOT NULL,
    "password_hash" TEXT NOT NULL,
    "is_active" BOOLEAN NOT NULL DEFAULT true,
    "last_login_at" TIMESTAMP(3),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "SuperAdmin_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "OtpLog" (
    "id" TEXT NOT NULL,
    "phone" TEXT NOT NULL,
    "otp_hash" TEXT NOT NULL,
    "purpose" "OtpPurpose" NOT NULL,
    "attempts" INTEGER NOT NULL DEFAULT 0,
    "max_attempts" INTEGER NOT NULL DEFAULT 5,
    "verified" BOOLEAN NOT NULL DEFAULT false,
    "verified_at" TIMESTAMP(3),
    "expires_at" TIMESTAMP(3) NOT NULL,
    "invalidated" BOOLEAN NOT NULL DEFAULT false,
    "msg91_req_id" TEXT,
    "ip_address" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "OtpLog_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Student" (
    "id" TEXT NOT NULL,
    "school_id" TEXT,
    "profile_type" "ProfileType" NOT NULL DEFAULT 'STUDENT',
    "setup_stage" "SetupStage" NOT NULL DEFAULT 'PENDING',
    "first_name" TEXT,
    "last_name" TEXT,
    "photo_url" TEXT,
    "gender" "Gender",
    "dob_encrypted" TEXT,
    "class" TEXT,
    "section" TEXT,
    "roll_number" TEXT,
    "admission_number" TEXT,
    "is_active" BOOLEAN NOT NULL DEFAULT true,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,
    "deleted_at" TIMESTAMP(3),

    CONSTRAINT "Student_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ParentStudent" (
    "id" TEXT NOT NULL,
    "parent_id" TEXT NOT NULL,
    "student_id" TEXT NOT NULL,
    "relationship" TEXT,
    "is_primary" BOOLEAN NOT NULL DEFAULT false,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ParentStudent_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "EmergencyProfile" (
    "id" TEXT NOT NULL,
    "student_id" TEXT NOT NULL,
    "blood_group" "BloodGroup",
    "allergies" TEXT,
    "conditions" TEXT,
    "medications" TEXT,
    "doctor_name" TEXT,
    "doctor_phone_encrypted" TEXT,
    "notes" TEXT,
    "visibility" "ProfileVisibility" NOT NULL DEFAULT 'PUBLIC',
    "is_visible" BOOLEAN NOT NULL DEFAULT true,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "EmergencyProfile_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "EmergencyContact" (
    "id" TEXT NOT NULL,
    "profile_id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "phone_encrypted" TEXT NOT NULL,
    "relationship" TEXT,
    "priority" INTEGER NOT NULL,
    "display_order" INTEGER NOT NULL DEFAULT 0,
    "is_active" BOOLEAN NOT NULL DEFAULT true,
    "call_enabled" BOOLEAN NOT NULL DEFAULT true,
    "whatsapp_enabled" BOOLEAN NOT NULL DEFAULT true,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "EmergencyContact_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "CardVisibility" (
    "id" TEXT NOT NULL,
    "student_id" TEXT NOT NULL,
    "visibility" "ProfileVisibility" NOT NULL DEFAULT 'PUBLIC',
    "hidden_fields" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "updated_by_parent" BOOLEAN NOT NULL DEFAULT false,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "CardVisibility_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ParentEditLog" (
    "id" TEXT NOT NULL,
    "school_id" TEXT,
    "student_id" TEXT NOT NULL,
    "parent_id" TEXT NOT NULL,
    "field_group" "ParentEditType" NOT NULL,
    "old_value" JSONB,
    "new_value" JSONB NOT NULL,
    "ip_address" TEXT,
    "user_agent" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ParentEditLog_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Token" (
    "id" TEXT NOT NULL,
    "school_id" TEXT NOT NULL,
    "student_id" TEXT,
    "token_hash" TEXT NOT NULL,
    "status" "TokenStatus" NOT NULL DEFAULT 'UNASSIGNED',
    "batch_id" TEXT,
    "order_id" TEXT,
    "order_item_id" TEXT,
    "replaced_by_id" TEXT,
    "activated_at" TIMESTAMP(3),
    "assigned_at" TIMESTAMP(3),
    "expires_at" TIMESTAMP(3),
    "revoked_at" TIMESTAMP(3),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Token_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "TokenBatch" (
    "id" TEXT NOT NULL,
    "school_id" TEXT NOT NULL,
    "order_id" TEXT,
    "count" INTEGER NOT NULL,
    "generated_count" INTEGER NOT NULL DEFAULT 0,
    "failed_count" INTEGER NOT NULL DEFAULT 0,
    "status" "TokenBatchStatus" NOT NULL DEFAULT 'PENDING',
    "created_by" TEXT NOT NULL,
    "notes" TEXT,
    "completed_at" TIMESTAMP(3),
    "error_log" JSONB,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "TokenBatch_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "QrAsset" (
    "id" TEXT NOT NULL,
    "token_id" TEXT NOT NULL,
    "school_id" TEXT NOT NULL,
    "storage_key" TEXT NOT NULL,
    "public_url" TEXT NOT NULL,
    "format" "QrFormat" NOT NULL DEFAULT 'PNG',
    "width_px" INTEGER NOT NULL DEFAULT 512,
    "height_px" INTEGER NOT NULL DEFAULT 512,
    "file_size_kb" INTEGER,
    "qr_type" "QrType" NOT NULL,
    "generated_by" TEXT NOT NULL,
    "order_id" TEXT,
    "is_active" BOOLEAN NOT NULL DEFAULT true,
    "generated_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "QrAsset_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "CardOrder" (
    "id" TEXT NOT NULL,
    "school_id" TEXT NOT NULL,
    "subscription_id" TEXT,
    "order_number" TEXT NOT NULL,
    "order_type" "OrderType" NOT NULL,
    "order_mode" "OrderMode" NOT NULL DEFAULT 'BULK',
    "channel" "OrderChannel" NOT NULL,
    "card_count" INTEGER NOT NULL,
    "status" "OrderStatus" NOT NULL DEFAULT 'PENDING',
    "payment_status" "OrderPaymentStatus" NOT NULL DEFAULT 'UNPAID',
    "advance_amount" INTEGER,
    "advance_paid_at" TIMESTAMP(3),
    "balance_amount" INTEGER,
    "balance_due_at" TIMESTAMP(3),
    "balance_paid_at" TIMESTAMP(3),
    "advance_invoice_id" TEXT,
    "balance_invoice_id" TEXT,
    "delivery_name" TEXT,
    "delivery_phone" TEXT,
    "delivery_address" TEXT,
    "delivery_city" TEXT,
    "delivery_state" TEXT,
    "delivery_pincode" TEXT,
    "delivery_notes" TEXT,
    "caller_name" TEXT,
    "caller_phone" TEXT,
    "call_notes" TEXT,
    "notes" TEXT,
    "admin_notes" TEXT,
    "confirmed_by" TEXT,
    "confirmed_at" TIMESTAMP(3),
    "tokens_generated_by" TEXT,
    "tokens_generated_at" TIMESTAMP(3),
    "card_design_files" JSONB,
    "card_design_by" TEXT,
    "card_design_at" TIMESTAMP(3),
    "vendor_id" TEXT,
    "vendor_notes" TEXT,
    "files_sent_to_vendor_at" TIMESTAMP(3),
    "files_sent_by" TEXT,
    "print_complete_at" TIMESTAMP(3),
    "print_complete_noted_by" TEXT,
    "status_changed_by" TEXT,
    "status_changed_at" TIMESTAMP(3),
    "status_note" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "CardOrder_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "CardOrderItem" (
    "id" TEXT NOT NULL,
    "order_id" TEXT NOT NULL,
    "student_id" TEXT,
    "token_id" TEXT,
    "student_name" TEXT NOT NULL,
    "class" TEXT,
    "section" TEXT,
    "roll_number" TEXT,
    "photo_url" TEXT,
    "status" "OrderItemStatus" NOT NULL DEFAULT 'PENDING',
    "qr_generated" BOOLEAN NOT NULL DEFAULT false,
    "card_design_url" TEXT,
    "card_printed" BOOLEAN NOT NULL DEFAULT false,
    "has_issue" BOOLEAN NOT NULL DEFAULT false,
    "issue_note" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "CardOrderItem_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "OrderStatusLog" (
    "id" TEXT NOT NULL,
    "order_id" TEXT NOT NULL,
    "from_status" "OrderStatus",
    "to_status" "OrderStatus" NOT NULL,
    "changed_by" TEXT NOT NULL,
    "note" TEXT,
    "metadata" JSONB,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "OrderStatusLog_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "OrderShipment" (
    "id" TEXT NOT NULL,
    "order_id" TEXT NOT NULL,
    "shiprocket_order_id" TEXT,
    "shiprocket_shipment_id" TEXT,
    "awb_code" TEXT,
    "courier_name" TEXT,
    "courier_id" INTEGER,
    "tracking_url" TEXT,
    "label_url" TEXT,
    "manifest_url" TEXT,
    "pickup_vendor_id" TEXT,
    "pickup_name" TEXT,
    "pickup_contact" TEXT,
    "pickup_address" TEXT,
    "pickup_city" TEXT,
    "pickup_state" TEXT,
    "pickup_pincode" TEXT,
    "delivery_name" TEXT,
    "delivery_phone" TEXT,
    "delivery_address" TEXT,
    "delivery_city" TEXT,
    "delivery_state" TEXT,
    "delivery_pincode" TEXT,
    "status" "ShipmentStatus" NOT NULL DEFAULT 'PENDING',
    "shiprocket_status" "ShiprocketStatus",
    "created_by" TEXT,
    "tracking_shared_at" TIMESTAMP(3),
    "tracking_shared_by" TEXT,
    "pickup_scheduled_at" TIMESTAMP(3),
    "picked_up_at" TIMESTAMP(3),
    "estimated_delivery_at" TIMESTAMP(3),
    "delivered_at" TIMESTAMP(3),
    "delivery_confirmed_by" TEXT,
    "notes" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "OrderShipment_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "VendorProfile" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "contact_name" TEXT,
    "phone" TEXT,
    "email" TEXT,
    "status" "VendorStatus" NOT NULL DEFAULT 'ACTIVE',
    "address" TEXT,
    "city" TEXT,
    "state" TEXT,
    "pincode" TEXT,
    "gstin" TEXT,
    "speciality" TEXT,
    "avg_turnaround_days" INTEGER,
    "notes" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "VendorProfile_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Card" (
    "id" TEXT NOT NULL,
    "school_id" TEXT NOT NULL,
    "student_id" TEXT,
    "token_id" TEXT,
    "order_id" TEXT,
    "card_number" TEXT NOT NULL,
    "file_url" TEXT,
    "print_status" "PrintStatus" NOT NULL DEFAULT 'PENDING',
    "printed_at" TIMESTAMP(3),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Card_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "CardRenewal" (
    "id" TEXT NOT NULL,
    "card_id" TEXT NOT NULL,
    "student_id" TEXT NOT NULL,
    "school_id" TEXT NOT NULL,
    "renewed_by" TEXT,
    "renewer_type" "ActorType" NOT NULL DEFAULT 'PARENT_USER',
    "old_expiry" TIMESTAMP(3) NOT NULL,
    "new_expiry" TIMESTAMP(3) NOT NULL,
    "amount_paid" INTEGER NOT NULL,
    "tax_amount" INTEGER NOT NULL DEFAULT 0,
    "payment_id" TEXT,
    "school_type" "SchoolType",
    "pricing_tier" "PricingTier",
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "CardRenewal_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Subscription" (
    "id" TEXT NOT NULL,
    "school_id" TEXT NOT NULL,
    "plan" "PlanType" NOT NULL DEFAULT 'GOVT_STANDARD',
    "status" "SubscriptionStatus" NOT NULL DEFAULT 'TRIALING',
    "provider" TEXT NOT NULL DEFAULT 'manual',
    "provider_sub_id" TEXT,
    "school_type" "SchoolType" NOT NULL DEFAULT 'PRIVATE',
    "pricing_tier" "PricingTier" NOT NULL DEFAULT 'PRIVATE_STANDARD',
    "student_count" INTEGER NOT NULL DEFAULT 0,
    "unit_price" INTEGER NOT NULL DEFAULT 19900,
    "renewal_price" INTEGER NOT NULL DEFAULT 10000,
    "total_amount" INTEGER NOT NULL DEFAULT 0,
    "tax_amount" INTEGER NOT NULL DEFAULT 0,
    "grand_total" INTEGER NOT NULL DEFAULT 0,
    "advance_paid" INTEGER NOT NULL DEFAULT 0,
    "balance_due" INTEGER NOT NULL DEFAULT 0,
    "fully_paid_at" TIMESTAMP(3),
    "current_period_start" TIMESTAMP(3) NOT NULL,
    "current_period_end" TIMESTAMP(3) NOT NULL,
    "trial_ends_at" TIMESTAMP(3),
    "cancel_reason" TEXT,
    "cancelled_at" TIMESTAMP(3),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Subscription_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "SchoolPaymentBatch" (
    "id" TEXT NOT NULL,
    "school_id" TEXT NOT NULL,
    "subscription_id" TEXT,
    "batch_number" TEXT NOT NULL,
    "student_count" INTEGER NOT NULL,
    "unit_price" INTEGER NOT NULL,
    "subtotal" INTEGER NOT NULL,
    "tax_amount" INTEGER NOT NULL DEFAULT 0,
    "total_amount" INTEGER NOT NULL,
    "amount_received" INTEGER NOT NULL DEFAULT 0,
    "payment_ref" TEXT,
    "payment_mode" "PaymentMode" NOT NULL DEFAULT 'BANK_TRANSFER',
    "status" "BatchPaymentStatus" NOT NULL DEFAULT 'PENDING',
    "is_advance" BOOLEAN NOT NULL DEFAULT false,
    "notes" TEXT,
    "received_at" TIMESTAMP(3),
    "verified_by" TEXT,
    "verified_at" TIMESTAMP(3),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "SchoolPaymentBatch_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Invoice" (
    "id" TEXT NOT NULL,
    "school_id" TEXT NOT NULL,
    "subscription_id" TEXT,
    "invoice_number" TEXT NOT NULL,
    "invoice_type" "InvoiceType" NOT NULL DEFAULT 'ADVANCE',
    "student_count" INTEGER,
    "unit_price" INTEGER,
    "amount" INTEGER NOT NULL,
    "tax_amount" INTEGER NOT NULL DEFAULT 0,
    "total_amount" INTEGER NOT NULL,
    "status" "InvoiceStatus" NOT NULL DEFAULT 'DRAFT',
    "issued_at" TIMESTAMP(3),
    "due_at" TIMESTAMP(3),
    "paid_at" TIMESTAMP(3),
    "pdf_url" TEXT,
    "notes" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Invoice_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Payment" (
    "id" TEXT NOT NULL,
    "school_id" TEXT NOT NULL,
    "subscription_id" TEXT,
    "order_id" TEXT,
    "invoice_id" TEXT,
    "amount" INTEGER NOT NULL,
    "tax_amount" INTEGER NOT NULL DEFAULT 0,
    "currency" TEXT NOT NULL DEFAULT 'INR',
    "status" "PaymentStatus" NOT NULL,
    "provider" TEXT NOT NULL,
    "provider_ref" TEXT,
    "payment_mode" "PaymentMode" NOT NULL DEFAULT 'BANK_TRANSFER',
    "is_advance" BOOLEAN NOT NULL DEFAULT false,
    "is_renewal" BOOLEAN NOT NULL DEFAULT false,
    "failure_reason" TEXT,
    "metadata" JSONB,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Payment_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "FeatureFlag" (
    "id" TEXT NOT NULL,
    "key" TEXT NOT NULL,
    "enabled" BOOLEAN NOT NULL DEFAULT false,
    "description" TEXT,
    "metadata" JSONB,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "FeatureFlag_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "SchoolFeatureFlag" (
    "id" TEXT NOT NULL,
    "school_id" TEXT NOT NULL,
    "key" TEXT NOT NULL,
    "enabled" BOOLEAN NOT NULL,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "SchoolFeatureFlag_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "CardTemplate" (
    "id" TEXT NOT NULL,
    "school_id" TEXT NOT NULL,
    "logo_url" TEXT,
    "background_color" TEXT NOT NULL DEFAULT '#FFFFFF',
    "primary_color" TEXT NOT NULL DEFAULT '#000000',
    "text_color" TEXT NOT NULL DEFAULT '#000000',
    "qr_dark_color" TEXT NOT NULL DEFAULT '#000000',
    "qr_light_color" TEXT NOT NULL DEFAULT '#FFFFFF',
    "cover_accent_color" TEXT NOT NULL DEFAULT '#E8342A',
    "cover_tagline" TEXT,
    "cards_per_sheet" INTEGER NOT NULL DEFAULT 8,
    "card_width" INTEGER NOT NULL DEFAULT 640,
    "card_height" INTEGER NOT NULL DEFAULT 400,
    "show_student_name" BOOLEAN NOT NULL DEFAULT true,
    "show_class" BOOLEAN NOT NULL DEFAULT true,
    "show_school_name" BOOLEAN NOT NULL DEFAULT true,
    "show_photo" BOOLEAN NOT NULL DEFAULT true,
    "is_locked" BOOLEAN NOT NULL DEFAULT true,
    "updated_by" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "CardTemplate_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Session" (
    "id" TEXT NOT NULL,
    "parent_user_id" TEXT,
    "school_user_id" TEXT,
    "admin_user_id" TEXT,
    "refresh_token_hash" TEXT NOT NULL,
    "device_id" TEXT,
    "device_info" TEXT,
    "user_agent" TEXT,
    "ip_address" TEXT,
    "is_active" BOOLEAN NOT NULL DEFAULT true,
    "revoked_at" TIMESTAMP(3),
    "revoke_reason" "SessionRevokeReason",
    "last_active_at" TIMESTAMP(3),
    "expires_at" TIMESTAMP(3) NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Session_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "BlacklistToken" (
    "token_hash" TEXT NOT NULL,
    "expires_at" TIMESTAMP(3) NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "BlacklistToken_pkey" PRIMARY KEY ("token_hash")
);

-- CreateTable
CREATE TABLE "DeviceLoginLog" (
    "id" TEXT NOT NULL,
    "parent_id" TEXT NOT NULL,
    "device_name" TEXT,
    "device_model" TEXT,
    "platform" "DevicePlatform" NOT NULL,
    "os_version" TEXT,
    "app_version" TEXT,
    "ip_address" TEXT,
    "ip_city" TEXT,
    "ip_country" TEXT,
    "login_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "email_sent" BOOLEAN NOT NULL DEFAULT false,
    "email_sent_at" TIMESTAMP(3),
    "was_forced" BOOLEAN NOT NULL DEFAULT false,

    CONSTRAINT "DeviceLoginLog_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ScanLog" (
    "id" TEXT NOT NULL,
    "token_id" TEXT NOT NULL,
    "school_id" TEXT NOT NULL,
    "result" "ScanResult" NOT NULL,
    "ip_address" TEXT,
    "ip_city" TEXT,
    "ip_country" TEXT,
    "ip_region" TEXT,
    "ip_capture_basis" "IpCaptureBasis" NOT NULL DEFAULT 'LEGITIMATE_INTEREST',
    "location_derived" BOOLEAN NOT NULL DEFAULT true,
    "latitude" DOUBLE PRECISION,
    "longitude" DOUBLE PRECISION,
    "device_hash" TEXT,
    "user_agent" TEXT,
    "scan_purpose" TEXT,
    "response_time_ms" INTEGER,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ScanLog_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ScanAnomaly" (
    "id" TEXT NOT NULL,
    "token_id" TEXT NOT NULL,
    "anomaly_type" "AnomalyType" NOT NULL,
    "severity" "AnomalySeverity" NOT NULL DEFAULT 'MEDIUM',
    "reason" TEXT,
    "metadata" JSONB,
    "resolved" BOOLEAN NOT NULL DEFAULT false,
    "resolved_at" TIMESTAMP(3),
    "resolved_by" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ScanAnomaly_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ScanRateLimit" (
    "id" TEXT NOT NULL,
    "identifier" TEXT NOT NULL,
    "identifier_type" "RateLimitIdentifierType" NOT NULL,
    "count" INTEGER NOT NULL DEFAULT 1,
    "window_start" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "last_hit" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "blocked_until" TIMESTAMP(3),
    "blocked_reason" TEXT,
    "block_count" INTEGER NOT NULL DEFAULT 0,

    CONSTRAINT "ScanRateLimit_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "LocationConsent" (
    "id" TEXT NOT NULL,
    "student_id" TEXT NOT NULL,
    "enabled" BOOLEAN NOT NULL DEFAULT false,
    "consented_by" TEXT,
    "consent_text" TEXT,
    "ip_address" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "LocationConsent_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "LocationEvent" (
    "id" TEXT NOT NULL,
    "student_id" TEXT NOT NULL,
    "school_id" TEXT NOT NULL,
    "token_id" TEXT,
    "latitude" DOUBLE PRECISION NOT NULL,
    "longitude" DOUBLE PRECISION NOT NULL,
    "accuracy" DOUBLE PRECISION,
    "altitude" DOUBLE PRECISION,
    "source" "LocationSource" NOT NULL DEFAULT 'SCAN_TRIGGER',
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "LocationEvent_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "RegistrationNonce" (
    "id" TEXT NOT NULL,
    "nonce" TEXT NOT NULL,
    "token_id" TEXT NOT NULL,
    "phone_index" TEXT,
    "expires_at" TIMESTAMP(3) NOT NULL,
    "used" BOOLEAN NOT NULL DEFAULT false,
    "used_at" TIMESTAMP(3),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "RegistrationNonce_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "TrustedScanZone" (
    "id" TEXT NOT NULL,
    "school_id" TEXT NOT NULL,
    "label" TEXT NOT NULL,
    "ip_range" TEXT,
    "latitude" DOUBLE PRECISION,
    "longitude" DOUBLE PRECISION,
    "radius_m" INTEGER NOT NULL DEFAULT 200,
    "is_active" BOOLEAN NOT NULL DEFAULT true,
    "created_by" TEXT,
    "updated_by" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "TrustedScanZone_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Notification" (
    "id" TEXT NOT NULL,
    "school_id" TEXT NOT NULL,
    "student_id" TEXT,
    "parent_id" TEXT,
    "type" "NotificationType" NOT NULL,
    "channel" "NotificationChannel" NOT NULL,
    "status" "NotificationStatus" NOT NULL DEFAULT 'QUEUED',
    "payload" JSONB,
    "pref_checked" BOOLEAN NOT NULL DEFAULT false,
    "retry_count" INTEGER NOT NULL DEFAULT 0,
    "sent_at" TIMESTAMP(3),
    "error" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Notification_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "AuditLog" (
    "id" TEXT NOT NULL,
    "school_id" TEXT,
    "actor_id" TEXT NOT NULL,
    "actor_type" "ActorType" NOT NULL,
    "action" TEXT NOT NULL,
    "entity" TEXT NOT NULL,
    "entity_id" TEXT NOT NULL,
    "old_value" JSONB,
    "new_value" JSONB,
    "metadata" JSONB,
    "ip_address" TEXT,
    "user_agent" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "AuditLog_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ApiKey" (
    "id" TEXT NOT NULL,
    "school_id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "key_hash" TEXT NOT NULL,
    "key_prefix" TEXT NOT NULL,
    "scopes" TEXT[],
    "last_used_at" TIMESTAMP(3),
    "expires_at" TIMESTAMP(3),
    "revoked_at" TIMESTAMP(3),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ApiKey_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Webhook" (
    "id" TEXT NOT NULL,
    "school_id" TEXT NOT NULL,
    "url" TEXT NOT NULL,
    "secret_hash" TEXT NOT NULL,
    "events" TEXT[],
    "is_active" BOOLEAN NOT NULL DEFAULT true,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Webhook_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "WebhookDelivery" (
    "id" TEXT NOT NULL,
    "webhook_id" TEXT NOT NULL,
    "idempotency_key" TEXT,
    "event_type" TEXT NOT NULL,
    "payload" JSONB NOT NULL,
    "status_code" INTEGER,
    "response" TEXT,
    "attempt" INTEGER NOT NULL DEFAULT 1,
    "delivered_at" TIMESTAMP(3),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "WebhookDelivery_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "WebhookEvent" (
    "id" TEXT NOT NULL,
    "provider" TEXT NOT NULL,
    "event_type" TEXT NOT NULL,
    "payload" JSONB NOT NULL,
    "received_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "processed" BOOLEAN NOT NULL DEFAULT false,
    "processed_at" TIMESTAMP(3),
    "error" TEXT,

    CONSTRAINT "WebhookEvent_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "DeadLetterQueue" (
    "id" TEXT NOT NULL,
    "job_type" TEXT NOT NULL,
    "payload" JSONB NOT NULL,
    "error_message" TEXT NOT NULL,
    "retry_count" INTEGER NOT NULL DEFAULT 0,
    "last_attempt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "resolved" BOOLEAN NOT NULL DEFAULT false,
    "resolved_at" TIMESTAMP(3),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "DeadLetterQueue_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "IdempotencyKey" (
    "id" TEXT NOT NULL,
    "key" TEXT NOT NULL,
    "resource_type" TEXT NOT NULL,
    "resource_id" TEXT NOT NULL,
    "status" TEXT NOT NULL,
    "response" JSONB,
    "expires_at" TIMESTAMP(3) NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "IdempotencyKey_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "FeatureFlagOverride" (
    "id" TEXT NOT NULL,
    "flag_key" TEXT NOT NULL,
    "target_type" TEXT NOT NULL,
    "target_id" TEXT NOT NULL,
    "enabled" BOOLEAN NOT NULL,
    "percentage" INTEGER,
    "expires_at" TIMESTAMP(3),
    "created_by" TEXT NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "FeatureFlagOverride_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "AuthAttempt" (
    "id" TEXT NOT NULL,
    "identifier" TEXT NOT NULL,
    "identifier_type" TEXT NOT NULL,
    "success" BOOLEAN NOT NULL DEFAULT false,
    "failure_reason" TEXT,
    "ip_address" TEXT,
    "user_agent" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "AuthAttempt_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "IpBlocklist" (
    "id" TEXT NOT NULL,
    "ip_address" TEXT NOT NULL,
    "reason" TEXT NOT NULL,
    "blocked_by" TEXT NOT NULL,
    "blocked_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "expires_at" TIMESTAMP(3),
    "is_active" BOOLEAN NOT NULL DEFAULT true,

    CONSTRAINT "IpBlocklist_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "School_code_key" ON "School"("code");

-- CreateIndex
CREATE UNIQUE INDEX "School_serial_number_key" ON "School"("serial_number");

-- CreateIndex
CREATE UNIQUE INDEX "School_udise_code_key" ON "School"("udise_code");

-- CreateIndex
CREATE INDEX "School_code_idx" ON "School"("code");

-- CreateIndex
CREATE INDEX "School_is_active_idx" ON "School"("is_active");

-- CreateIndex
CREATE INDEX "School_school_type_idx" ON "School"("school_type");

-- CreateIndex
CREATE INDEX "School_serial_number_idx" ON "School"("serial_number");

-- CreateIndex
CREATE INDEX "School_pricing_tier_idx" ON "School"("pricing_tier");

-- CreateIndex
CREATE INDEX "School_state_idx" ON "School"("state");

-- CreateIndex
CREATE INDEX "School_school_type_is_active_idx" ON "School"("school_type", "is_active");

-- CreateIndex
CREATE UNIQUE INDEX "SchoolSettings_school_id_key" ON "SchoolSettings"("school_id");

-- CreateIndex
CREATE INDEX "SchoolSettings_allow_location_idx" ON "SchoolSettings"("allow_location");

-- CreateIndex
CREATE INDEX "SchoolSettings_school_id_allow_location_idx" ON "SchoolSettings"("school_id", "allow_location");

-- CreateIndex
CREATE UNIQUE INDEX "SchoolUser_email_key" ON "SchoolUser"("email");

-- CreateIndex
CREATE INDEX "SchoolUser_school_id_idx" ON "SchoolUser"("school_id");

-- CreateIndex
CREATE INDEX "SchoolUser_school_id_is_active_idx" ON "SchoolUser"("school_id", "is_active");

-- CreateIndex
CREATE UNIQUE INDEX "ParentUser_email_key" ON "ParentUser"("email");

-- CreateIndex
CREATE UNIQUE INDEX "ParentUser_phone_key" ON "ParentUser"("phone");

-- CreateIndex
CREATE UNIQUE INDEX "ParentUser_phone_index_key" ON "ParentUser"("phone_index");

-- CreateIndex
CREATE INDEX "ParentUser_phone_index_idx" ON "ParentUser"("phone_index");

-- CreateIndex
CREATE INDEX "ParentUser_status_idx" ON "ParentUser"("status");

-- CreateIndex
CREATE INDEX "ParentUser_deleted_at_idx" ON "ParentUser"("deleted_at");

-- CreateIndex
CREATE UNIQUE INDEX "ParentDevice_device_token_key" ON "ParentDevice"("device_token");

-- CreateIndex
CREATE INDEX "ParentDevice_parent_id_idx" ON "ParentDevice"("parent_id");

-- CreateIndex
CREATE INDEX "ParentDevice_parent_id_is_active_idx" ON "ParentDevice"("parent_id", "is_active");

-- CreateIndex
CREATE UNIQUE INDEX "ParentNotificationPref_parent_id_key" ON "ParentNotificationPref"("parent_id");

-- CreateIndex
CREATE UNIQUE INDEX "SuperAdmin_email_key" ON "SuperAdmin"("email");

-- CreateIndex
CREATE INDEX "SuperAdmin_email_idx" ON "SuperAdmin"("email");

-- CreateIndex
CREATE INDEX "SuperAdmin_is_active_idx" ON "SuperAdmin"("is_active");

-- CreateIndex
CREATE INDEX "OtpLog_phone_purpose_idx" ON "OtpLog"("phone", "purpose");

-- CreateIndex
CREATE INDEX "OtpLog_expires_at_idx" ON "OtpLog"("expires_at");

-- CreateIndex
CREATE INDEX "OtpLog_msg91_req_id_idx" ON "OtpLog"("msg91_req_id");

-- CreateIndex
CREATE INDEX "Student_school_id_idx" ON "Student"("school_id");

-- CreateIndex
CREATE INDEX "Student_school_id_is_active_idx" ON "Student"("school_id", "is_active");

-- CreateIndex
CREATE INDEX "Student_school_id_profile_type_idx" ON "Student"("school_id", "profile_type");

-- CreateIndex
CREATE INDEX "Student_setup_stage_idx" ON "Student"("setup_stage");

-- CreateIndex
CREATE INDEX "Student_deleted_at_idx" ON "Student"("deleted_at");

-- CreateIndex
CREATE INDEX "ParentStudent_student_id_idx" ON "ParentStudent"("student_id");

-- CreateIndex
CREATE INDEX "ParentStudent_parent_id_idx" ON "ParentStudent"("parent_id");

-- CreateIndex
CREATE UNIQUE INDEX "ParentStudent_parent_id_student_id_key" ON "ParentStudent"("parent_id", "student_id");

-- CreateIndex
CREATE UNIQUE INDEX "EmergencyProfile_student_id_key" ON "EmergencyProfile"("student_id");

-- CreateIndex
CREATE INDEX "EmergencyContact_profile_id_idx" ON "EmergencyContact"("profile_id");

-- CreateIndex
CREATE INDEX "EmergencyContact_profile_id_priority_idx" ON "EmergencyContact"("profile_id", "priority");

-- CreateIndex
CREATE INDEX "EmergencyContact_profile_id_is_active_idx" ON "EmergencyContact"("profile_id", "is_active");

-- CreateIndex
CREATE UNIQUE INDEX "CardVisibility_student_id_key" ON "CardVisibility"("student_id");

-- CreateIndex
CREATE INDEX "ParentEditLog_student_id_idx" ON "ParentEditLog"("student_id");

-- CreateIndex
CREATE INDEX "ParentEditLog_parent_id_idx" ON "ParentEditLog"("parent_id");

-- CreateIndex
CREATE INDEX "ParentEditLog_school_id_idx" ON "ParentEditLog"("school_id");

-- CreateIndex
CREATE INDEX "ParentEditLog_created_at_idx" ON "ParentEditLog"("created_at");

-- CreateIndex
CREATE INDEX "ParentEditLog_field_group_idx" ON "ParentEditLog"("field_group");

-- CreateIndex
CREATE UNIQUE INDEX "Token_token_hash_key" ON "Token"("token_hash");

-- CreateIndex
CREATE INDEX "Token_school_id_idx" ON "Token"("school_id");

-- CreateIndex
CREATE INDEX "Token_school_id_status_idx" ON "Token"("school_id", "status");

-- CreateIndex
CREATE INDEX "Token_student_id_idx" ON "Token"("student_id");

-- CreateIndex
CREATE INDEX "Token_batch_id_idx" ON "Token"("batch_id");

-- CreateIndex
CREATE INDEX "Token_order_id_idx" ON "Token"("order_id");

-- CreateIndex
CREATE INDEX "Token_status_idx" ON "Token"("status");

-- CreateIndex
CREATE INDEX "Token_expires_at_idx" ON "Token"("expires_at");

-- CreateIndex
CREATE INDEX "TokenBatch_school_id_idx" ON "TokenBatch"("school_id");

-- CreateIndex
CREATE INDEX "TokenBatch_order_id_idx" ON "TokenBatch"("order_id");

-- CreateIndex
CREATE INDEX "TokenBatch_status_idx" ON "TokenBatch"("status");

-- CreateIndex
CREATE INDEX "TokenBatch_school_id_created_at_idx" ON "TokenBatch"("school_id", "created_at");

-- CreateIndex
CREATE UNIQUE INDEX "QrAsset_token_id_key" ON "QrAsset"("token_id");

-- CreateIndex
CREATE UNIQUE INDEX "QrAsset_storage_key_key" ON "QrAsset"("storage_key");

-- CreateIndex
CREATE INDEX "QrAsset_school_id_idx" ON "QrAsset"("school_id");

-- CreateIndex
CREATE INDEX "QrAsset_order_id_idx" ON "QrAsset"("order_id");

-- CreateIndex
CREATE INDEX "QrAsset_qr_type_idx" ON "QrAsset"("qr_type");

-- CreateIndex
CREATE INDEX "QrAsset_is_active_idx" ON "QrAsset"("is_active");

-- CreateIndex
CREATE INDEX "QrAsset_generated_at_idx" ON "QrAsset"("generated_at");

-- CreateIndex
CREATE UNIQUE INDEX "CardOrder_order_number_key" ON "CardOrder"("order_number");

-- CreateIndex
CREATE INDEX "CardOrder_school_id_idx" ON "CardOrder"("school_id");

-- CreateIndex
CREATE INDEX "CardOrder_status_idx" ON "CardOrder"("status");

-- CreateIndex
CREATE INDEX "CardOrder_payment_status_idx" ON "CardOrder"("payment_status");

-- CreateIndex
CREATE INDEX "CardOrder_channel_idx" ON "CardOrder"("channel");

-- CreateIndex
CREATE INDEX "CardOrder_order_type_idx" ON "CardOrder"("order_type");

-- CreateIndex
CREATE INDEX "CardOrder_vendor_id_idx" ON "CardOrder"("vendor_id");

-- CreateIndex
CREATE INDEX "CardOrder_created_at_idx" ON "CardOrder"("created_at");

-- CreateIndex
CREATE INDEX "CardOrder_school_id_status_idx" ON "CardOrder"("school_id", "status");

-- CreateIndex
CREATE INDEX "CardOrder_status_created_at_idx" ON "CardOrder"("status", "created_at");

-- CreateIndex
CREATE INDEX "CardOrder_channel_status_idx" ON "CardOrder"("channel", "status");

-- CreateIndex
CREATE UNIQUE INDEX "CardOrderItem_token_id_key" ON "CardOrderItem"("token_id");

-- CreateIndex
CREATE INDEX "CardOrderItem_order_id_idx" ON "CardOrderItem"("order_id");

-- CreateIndex
CREATE INDEX "CardOrderItem_student_id_idx" ON "CardOrderItem"("student_id");

-- CreateIndex
CREATE INDEX "CardOrderItem_status_idx" ON "CardOrderItem"("status");

-- CreateIndex
CREATE INDEX "CardOrderItem_order_id_status_idx" ON "CardOrderItem"("order_id", "status");

-- CreateIndex
CREATE INDEX "CardOrderItem_order_id_card_printed_idx" ON "CardOrderItem"("order_id", "card_printed");

-- CreateIndex
CREATE INDEX "OrderStatusLog_order_id_idx" ON "OrderStatusLog"("order_id");

-- CreateIndex
CREATE INDEX "OrderStatusLog_order_id_created_at_idx" ON "OrderStatusLog"("order_id", "created_at");

-- CreateIndex
CREATE INDEX "OrderStatusLog_changed_by_idx" ON "OrderStatusLog"("changed_by");

-- CreateIndex
CREATE INDEX "OrderStatusLog_to_status_created_at_idx" ON "OrderStatusLog"("to_status", "created_at");

-- CreateIndex
CREATE UNIQUE INDEX "OrderShipment_order_id_key" ON "OrderShipment"("order_id");

-- CreateIndex
CREATE UNIQUE INDEX "OrderShipment_awb_code_key" ON "OrderShipment"("awb_code");

-- CreateIndex
CREATE INDEX "OrderShipment_status_idx" ON "OrderShipment"("status");

-- CreateIndex
CREATE INDEX "OrderShipment_awb_code_idx" ON "OrderShipment"("awb_code");

-- CreateIndex
CREATE INDEX "OrderShipment_shiprocket_order_id_idx" ON "OrderShipment"("shiprocket_order_id");

-- CreateIndex
CREATE INDEX "OrderShipment_status_created_at_idx" ON "OrderShipment"("status", "created_at");

-- CreateIndex
CREATE INDEX "VendorProfile_status_idx" ON "VendorProfile"("status");

-- CreateIndex
CREATE UNIQUE INDEX "Card_card_number_key" ON "Card"("card_number");

-- CreateIndex
CREATE INDEX "Card_school_id_idx" ON "Card"("school_id");

-- CreateIndex
CREATE INDEX "Card_student_id_idx" ON "Card"("student_id");

-- CreateIndex
CREATE INDEX "Card_token_id_idx" ON "Card"("token_id");

-- CreateIndex
CREATE INDEX "Card_order_id_idx" ON "Card"("order_id");

-- CreateIndex
CREATE INDEX "Card_print_status_idx" ON "Card"("print_status");

-- CreateIndex
CREATE INDEX "CardRenewal_card_id_idx" ON "CardRenewal"("card_id");

-- CreateIndex
CREATE INDEX "CardRenewal_student_id_idx" ON "CardRenewal"("student_id");

-- CreateIndex
CREATE INDEX "CardRenewal_school_id_idx" ON "CardRenewal"("school_id");

-- CreateIndex
CREATE INDEX "CardRenewal_created_at_idx" ON "CardRenewal"("created_at");

-- CreateIndex
CREATE UNIQUE INDEX "Subscription_provider_sub_id_key" ON "Subscription"("provider_sub_id");

-- CreateIndex
CREATE INDEX "Subscription_school_id_idx" ON "Subscription"("school_id");

-- CreateIndex
CREATE INDEX "Subscription_status_idx" ON "Subscription"("status");

-- CreateIndex
CREATE INDEX "Subscription_current_period_end_idx" ON "Subscription"("current_period_end");

-- CreateIndex
CREATE UNIQUE INDEX "SchoolPaymentBatch_batch_number_key" ON "SchoolPaymentBatch"("batch_number");

-- CreateIndex
CREATE INDEX "SchoolPaymentBatch_school_id_idx" ON "SchoolPaymentBatch"("school_id");

-- CreateIndex
CREATE INDEX "SchoolPaymentBatch_status_idx" ON "SchoolPaymentBatch"("status");

-- CreateIndex
CREATE INDEX "SchoolPaymentBatch_received_at_idx" ON "SchoolPaymentBatch"("received_at");

-- CreateIndex
CREATE INDEX "SchoolPaymentBatch_school_id_status_idx" ON "SchoolPaymentBatch"("school_id", "status");

-- CreateIndex
CREATE UNIQUE INDEX "Invoice_invoice_number_key" ON "Invoice"("invoice_number");

-- CreateIndex
CREATE INDEX "Invoice_school_id_idx" ON "Invoice"("school_id");

-- CreateIndex
CREATE INDEX "Invoice_status_idx" ON "Invoice"("status");

-- CreateIndex
CREATE INDEX "Invoice_issued_at_idx" ON "Invoice"("issued_at");

-- CreateIndex
CREATE INDEX "Invoice_school_id_status_idx" ON "Invoice"("school_id", "status");

-- CreateIndex
CREATE UNIQUE INDEX "Payment_provider_ref_key" ON "Payment"("provider_ref");

-- CreateIndex
CREATE INDEX "Payment_school_id_idx" ON "Payment"("school_id");

-- CreateIndex
CREATE INDEX "Payment_subscription_id_idx" ON "Payment"("subscription_id");

-- CreateIndex
CREATE INDEX "Payment_order_id_idx" ON "Payment"("order_id");

-- CreateIndex
CREATE INDEX "Payment_invoice_id_idx" ON "Payment"("invoice_id");

-- CreateIndex
CREATE INDEX "Payment_status_idx" ON "Payment"("status");

-- CreateIndex
CREATE INDEX "Payment_created_at_idx" ON "Payment"("created_at");

-- CreateIndex
CREATE UNIQUE INDEX "FeatureFlag_key_key" ON "FeatureFlag"("key");

-- CreateIndex
CREATE INDEX "SchoolFeatureFlag_school_id_idx" ON "SchoolFeatureFlag"("school_id");

-- CreateIndex
CREATE UNIQUE INDEX "SchoolFeatureFlag_school_id_key_key" ON "SchoolFeatureFlag"("school_id", "key");

-- CreateIndex
CREATE UNIQUE INDEX "CardTemplate_school_id_key" ON "CardTemplate"("school_id");

-- CreateIndex
CREATE UNIQUE INDEX "Session_refresh_token_hash_key" ON "Session"("refresh_token_hash");

-- CreateIndex
CREATE INDEX "Session_parent_user_id_idx" ON "Session"("parent_user_id");

-- CreateIndex
CREATE INDEX "Session_parent_user_id_is_active_idx" ON "Session"("parent_user_id", "is_active");

-- CreateIndex
CREATE INDEX "Session_school_user_id_idx" ON "Session"("school_user_id");

-- CreateIndex
CREATE INDEX "Session_school_user_id_is_active_idx" ON "Session"("school_user_id", "is_active");

-- CreateIndex
CREATE INDEX "Session_admin_user_id_idx" ON "Session"("admin_user_id");

-- CreateIndex
CREATE INDEX "Session_expires_at_idx" ON "Session"("expires_at");

-- CreateIndex
CREATE INDEX "Session_last_active_at_idx" ON "Session"("last_active_at");

-- CreateIndex
CREATE INDEX "Session_is_active_idx" ON "Session"("is_active");

-- CreateIndex
CREATE INDEX "BlacklistToken_expires_at_idx" ON "BlacklistToken"("expires_at");

-- CreateIndex
CREATE INDEX "DeviceLoginLog_parent_id_idx" ON "DeviceLoginLog"("parent_id");

-- CreateIndex
CREATE INDEX "DeviceLoginLog_parent_id_login_at_idx" ON "DeviceLoginLog"("parent_id", "login_at");

-- CreateIndex
CREATE INDEX "DeviceLoginLog_login_at_idx" ON "DeviceLoginLog"("login_at");

-- CreateIndex
CREATE INDEX "ScanLog_token_id_idx" ON "ScanLog"("token_id");

-- CreateIndex
CREATE INDEX "ScanLog_token_id_created_at_idx" ON "ScanLog"("token_id", "created_at");

-- CreateIndex
CREATE INDEX "ScanLog_school_id_created_at_idx" ON "ScanLog"("school_id", "created_at");

-- CreateIndex
CREATE INDEX "ScanLog_school_id_result_idx" ON "ScanLog"("school_id", "result");

-- CreateIndex
CREATE INDEX "ScanLog_created_at_idx" ON "ScanLog"("created_at");

-- CreateIndex
CREATE INDEX "ScanLog_result_idx" ON "ScanLog"("result");

-- CreateIndex
CREATE INDEX "ScanLog_result_created_at_idx" ON "ScanLog"("result", "created_at");

-- CreateIndex
CREATE INDEX "ScanLog_device_hash_idx" ON "ScanLog"("device_hash");

-- CreateIndex
CREATE INDEX "ScanLog_ip_address_idx" ON "ScanLog"("ip_address");

-- CreateIndex
CREATE INDEX "ScanAnomaly_token_id_idx" ON "ScanAnomaly"("token_id");

-- CreateIndex
CREATE INDEX "ScanAnomaly_anomaly_type_idx" ON "ScanAnomaly"("anomaly_type");

-- CreateIndex
CREATE INDEX "ScanAnomaly_severity_idx" ON "ScanAnomaly"("severity");

-- CreateIndex
CREATE INDEX "ScanAnomaly_resolved_idx" ON "ScanAnomaly"("resolved");

-- CreateIndex
CREATE INDEX "ScanAnomaly_created_at_idx" ON "ScanAnomaly"("created_at");

-- CreateIndex
CREATE INDEX "ScanRateLimit_identifier_identifier_type_idx" ON "ScanRateLimit"("identifier", "identifier_type");

-- CreateIndex
CREATE INDEX "ScanRateLimit_window_start_idx" ON "ScanRateLimit"("window_start");

-- CreateIndex
CREATE INDEX "ScanRateLimit_blocked_until_idx" ON "ScanRateLimit"("blocked_until");

-- CreateIndex
CREATE UNIQUE INDEX "ScanRateLimit_identifier_identifier_type_key" ON "ScanRateLimit"("identifier", "identifier_type");

-- CreateIndex
CREATE UNIQUE INDEX "LocationConsent_student_id_key" ON "LocationConsent"("student_id");

-- CreateIndex
CREATE INDEX "LocationEvent_student_id_idx" ON "LocationEvent"("student_id");

-- CreateIndex
CREATE INDEX "LocationEvent_student_id_created_at_idx" ON "LocationEvent"("student_id", "created_at");

-- CreateIndex
CREATE INDEX "LocationEvent_school_id_created_at_idx" ON "LocationEvent"("school_id", "created_at");

-- CreateIndex
CREATE INDEX "LocationEvent_token_id_idx" ON "LocationEvent"("token_id");

-- CreateIndex
CREATE INDEX "LocationEvent_source_idx" ON "LocationEvent"("source");

-- CreateIndex
CREATE UNIQUE INDEX "RegistrationNonce_nonce_key" ON "RegistrationNonce"("nonce");

-- CreateIndex
CREATE INDEX "RegistrationNonce_token_id_idx" ON "RegistrationNonce"("token_id");

-- CreateIndex
CREATE INDEX "RegistrationNonce_expires_at_idx" ON "RegistrationNonce"("expires_at");

-- CreateIndex
CREATE INDEX "TrustedScanZone_school_id_idx" ON "TrustedScanZone"("school_id");

-- CreateIndex
CREATE INDEX "TrustedScanZone_school_id_is_active_idx" ON "TrustedScanZone"("school_id", "is_active");

-- CreateIndex
CREATE INDEX "Notification_school_id_idx" ON "Notification"("school_id");

-- CreateIndex
CREATE INDEX "Notification_student_id_idx" ON "Notification"("student_id");

-- CreateIndex
CREATE INDEX "Notification_parent_id_idx" ON "Notification"("parent_id");

-- CreateIndex
CREATE INDEX "Notification_status_idx" ON "Notification"("status");

-- CreateIndex
CREATE INDEX "Notification_type_idx" ON "Notification"("type");

-- CreateIndex
CREATE INDEX "Notification_created_at_idx" ON "Notification"("created_at");

-- CreateIndex
CREATE INDEX "Notification_status_created_at_idx" ON "Notification"("status", "created_at");

-- CreateIndex
CREATE INDEX "AuditLog_actor_id_idx" ON "AuditLog"("actor_id");

-- CreateIndex
CREATE INDEX "AuditLog_school_id_idx" ON "AuditLog"("school_id");

-- CreateIndex
CREATE INDEX "AuditLog_entity_entity_id_idx" ON "AuditLog"("entity", "entity_id");

-- CreateIndex
CREATE INDEX "AuditLog_action_idx" ON "AuditLog"("action");

-- CreateIndex
CREATE INDEX "AuditLog_created_at_idx" ON "AuditLog"("created_at");

-- CreateIndex
CREATE INDEX "AuditLog_actor_type_created_at_idx" ON "AuditLog"("actor_type", "created_at");

-- CreateIndex
CREATE UNIQUE INDEX "ApiKey_key_hash_key" ON "ApiKey"("key_hash");

-- CreateIndex
CREATE INDEX "ApiKey_school_id_idx" ON "ApiKey"("school_id");

-- CreateIndex
CREATE INDEX "ApiKey_revoked_at_idx" ON "ApiKey"("revoked_at");

-- CreateIndex
CREATE INDEX "Webhook_school_id_idx" ON "Webhook"("school_id");

-- CreateIndex
CREATE INDEX "Webhook_school_id_is_active_idx" ON "Webhook"("school_id", "is_active");

-- CreateIndex
CREATE UNIQUE INDEX "WebhookDelivery_idempotency_key_key" ON "WebhookDelivery"("idempotency_key");

-- CreateIndex
CREATE INDEX "WebhookDelivery_webhook_id_idx" ON "WebhookDelivery"("webhook_id");

-- CreateIndex
CREATE INDEX "WebhookDelivery_webhook_id_created_at_idx" ON "WebhookDelivery"("webhook_id", "created_at");

-- CreateIndex
CREATE INDEX "WebhookEvent_provider_event_type_idx" ON "WebhookEvent"("provider", "event_type");

-- CreateIndex
CREATE INDEX "WebhookEvent_processed_idx" ON "WebhookEvent"("processed");

-- CreateIndex
CREATE INDEX "WebhookEvent_received_at_idx" ON "WebhookEvent"("received_at");

-- CreateIndex
CREATE INDEX "DeadLetterQueue_job_type_idx" ON "DeadLetterQueue"("job_type");

-- CreateIndex
CREATE INDEX "DeadLetterQueue_job_type_resolved_idx" ON "DeadLetterQueue"("job_type", "resolved");

-- CreateIndex
CREATE INDEX "DeadLetterQueue_created_at_idx" ON "DeadLetterQueue"("created_at");

-- CreateIndex
CREATE UNIQUE INDEX "IdempotencyKey_key_key" ON "IdempotencyKey"("key");

-- CreateIndex
CREATE INDEX "IdempotencyKey_key_idx" ON "IdempotencyKey"("key");

-- CreateIndex
CREATE INDEX "IdempotencyKey_resource_type_resource_id_idx" ON "IdempotencyKey"("resource_type", "resource_id");

-- CreateIndex
CREATE INDEX "IdempotencyKey_expires_at_idx" ON "IdempotencyKey"("expires_at");

-- CreateIndex
CREATE INDEX "FeatureFlagOverride_flag_key_idx" ON "FeatureFlagOverride"("flag_key");

-- CreateIndex
CREATE INDEX "FeatureFlagOverride_expires_at_idx" ON "FeatureFlagOverride"("expires_at");

-- CreateIndex
CREATE UNIQUE INDEX "FeatureFlagOverride_flag_key_target_type_target_id_key" ON "FeatureFlagOverride"("flag_key", "target_type", "target_id");

-- CreateIndex
CREATE INDEX "AuthAttempt_identifier_created_at_idx" ON "AuthAttempt"("identifier", "created_at");

-- CreateIndex
CREATE INDEX "AuthAttempt_ip_address_created_at_idx" ON "AuthAttempt"("ip_address", "created_at");

-- CreateIndex
CREATE UNIQUE INDEX "IpBlocklist_ip_address_key" ON "IpBlocklist"("ip_address");

-- CreateIndex
CREATE INDEX "IpBlocklist_ip_address_idx" ON "IpBlocklist"("ip_address");

-- CreateIndex
CREATE INDEX "IpBlocklist_ip_address_is_active_idx" ON "IpBlocklist"("ip_address", "is_active");

-- CreateIndex
CREATE INDEX "IpBlocklist_expires_at_idx" ON "IpBlocklist"("expires_at");

-- AddForeignKey
ALTER TABLE "SchoolSettings" ADD CONSTRAINT "SchoolSettings_school_id_fkey" FOREIGN KEY ("school_id") REFERENCES "School"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SchoolUser" ADD CONSTRAINT "SchoolUser_school_id_fkey" FOREIGN KEY ("school_id") REFERENCES "School"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ParentDevice" ADD CONSTRAINT "ParentDevice_parent_id_fkey" FOREIGN KEY ("parent_id") REFERENCES "ParentUser"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ParentNotificationPref" ADD CONSTRAINT "ParentNotificationPref_parent_id_fkey" FOREIGN KEY ("parent_id") REFERENCES "ParentUser"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Student" ADD CONSTRAINT "Student_school_id_fkey" FOREIGN KEY ("school_id") REFERENCES "School"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ParentStudent" ADD CONSTRAINT "ParentStudent_parent_id_fkey" FOREIGN KEY ("parent_id") REFERENCES "ParentUser"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ParentStudent" ADD CONSTRAINT "ParentStudent_student_id_fkey" FOREIGN KEY ("student_id") REFERENCES "Student"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "EmergencyProfile" ADD CONSTRAINT "EmergencyProfile_student_id_fkey" FOREIGN KEY ("student_id") REFERENCES "Student"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "EmergencyContact" ADD CONSTRAINT "EmergencyContact_profile_id_fkey" FOREIGN KEY ("profile_id") REFERENCES "EmergencyProfile"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CardVisibility" ADD CONSTRAINT "CardVisibility_student_id_fkey" FOREIGN KEY ("student_id") REFERENCES "Student"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ParentEditLog" ADD CONSTRAINT "ParentEditLog_school_id_fkey" FOREIGN KEY ("school_id") REFERENCES "School"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ParentEditLog" ADD CONSTRAINT "ParentEditLog_student_id_fkey" FOREIGN KEY ("student_id") REFERENCES "Student"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ParentEditLog" ADD CONSTRAINT "ParentEditLog_parent_id_fkey" FOREIGN KEY ("parent_id") REFERENCES "ParentUser"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Token" ADD CONSTRAINT "Token_batch_id_fkey" FOREIGN KEY ("batch_id") REFERENCES "TokenBatch"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Token" ADD CONSTRAINT "Token_order_id_fkey" FOREIGN KEY ("order_id") REFERENCES "CardOrder"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Token" ADD CONSTRAINT "Token_replaced_by_id_fkey" FOREIGN KEY ("replaced_by_id") REFERENCES "Token"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Token" ADD CONSTRAINT "Token_school_id_fkey" FOREIGN KEY ("school_id") REFERENCES "School"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Token" ADD CONSTRAINT "Token_student_id_fkey" FOREIGN KEY ("student_id") REFERENCES "Student"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "TokenBatch" ADD CONSTRAINT "TokenBatch_order_id_fkey" FOREIGN KEY ("order_id") REFERENCES "CardOrder"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "TokenBatch" ADD CONSTRAINT "TokenBatch_school_id_fkey" FOREIGN KEY ("school_id") REFERENCES "School"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "QrAsset" ADD CONSTRAINT "QrAsset_token_id_fkey" FOREIGN KEY ("token_id") REFERENCES "Token"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "QrAsset" ADD CONSTRAINT "QrAsset_order_id_fkey" FOREIGN KEY ("order_id") REFERENCES "CardOrder"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "QrAsset" ADD CONSTRAINT "QrAsset_school_id_fkey" FOREIGN KEY ("school_id") REFERENCES "School"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CardOrder" ADD CONSTRAINT "CardOrder_advance_invoice_id_fkey" FOREIGN KEY ("advance_invoice_id") REFERENCES "Invoice"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CardOrder" ADD CONSTRAINT "CardOrder_balance_invoice_id_fkey" FOREIGN KEY ("balance_invoice_id") REFERENCES "Invoice"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CardOrder" ADD CONSTRAINT "CardOrder_vendor_id_fkey" FOREIGN KEY ("vendor_id") REFERENCES "VendorProfile"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CardOrder" ADD CONSTRAINT "CardOrder_school_id_fkey" FOREIGN KEY ("school_id") REFERENCES "School"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CardOrder" ADD CONSTRAINT "CardOrder_subscription_id_fkey" FOREIGN KEY ("subscription_id") REFERENCES "Subscription"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CardOrderItem" ADD CONSTRAINT "CardOrderItem_order_id_fkey" FOREIGN KEY ("order_id") REFERENCES "CardOrder"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CardOrderItem" ADD CONSTRAINT "CardOrderItem_token_id_fkey" FOREIGN KEY ("token_id") REFERENCES "Token"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "OrderStatusLog" ADD CONSTRAINT "OrderStatusLog_order_id_fkey" FOREIGN KEY ("order_id") REFERENCES "CardOrder"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "OrderShipment" ADD CONSTRAINT "OrderShipment_order_id_fkey" FOREIGN KEY ("order_id") REFERENCES "CardOrder"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Card" ADD CONSTRAINT "Card_school_id_fkey" FOREIGN KEY ("school_id") REFERENCES "School"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Card" ADD CONSTRAINT "Card_student_id_fkey" FOREIGN KEY ("student_id") REFERENCES "Student"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Card" ADD CONSTRAINT "Card_token_id_fkey" FOREIGN KEY ("token_id") REFERENCES "Token"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Card" ADD CONSTRAINT "Card_order_id_fkey" FOREIGN KEY ("order_id") REFERENCES "CardOrder"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CardRenewal" ADD CONSTRAINT "CardRenewal_card_id_fkey" FOREIGN KEY ("card_id") REFERENCES "Card"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CardRenewal" ADD CONSTRAINT "CardRenewal_payment_id_fkey" FOREIGN KEY ("payment_id") REFERENCES "Payment"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CardRenewal" ADD CONSTRAINT "CardRenewal_school_id_fkey" FOREIGN KEY ("school_id") REFERENCES "School"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CardRenewal" ADD CONSTRAINT "CardRenewal_student_id_fkey" FOREIGN KEY ("student_id") REFERENCES "Student"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Subscription" ADD CONSTRAINT "Subscription_school_id_fkey" FOREIGN KEY ("school_id") REFERENCES "School"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SchoolPaymentBatch" ADD CONSTRAINT "SchoolPaymentBatch_school_id_fkey" FOREIGN KEY ("school_id") REFERENCES "School"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SchoolPaymentBatch" ADD CONSTRAINT "SchoolPaymentBatch_subscription_id_fkey" FOREIGN KEY ("subscription_id") REFERENCES "Subscription"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Invoice" ADD CONSTRAINT "Invoice_school_id_fkey" FOREIGN KEY ("school_id") REFERENCES "School"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Invoice" ADD CONSTRAINT "Invoice_subscription_id_fkey" FOREIGN KEY ("subscription_id") REFERENCES "Subscription"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Payment" ADD CONSTRAINT "Payment_invoice_id_fkey" FOREIGN KEY ("invoice_id") REFERENCES "Invoice"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Payment" ADD CONSTRAINT "Payment_order_id_fkey" FOREIGN KEY ("order_id") REFERENCES "CardOrder"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Payment" ADD CONSTRAINT "Payment_school_id_fkey" FOREIGN KEY ("school_id") REFERENCES "School"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Payment" ADD CONSTRAINT "Payment_subscription_id_fkey" FOREIGN KEY ("subscription_id") REFERENCES "Subscription"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SchoolFeatureFlag" ADD CONSTRAINT "SchoolFeatureFlag_school_id_fkey" FOREIGN KEY ("school_id") REFERENCES "School"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CardTemplate" ADD CONSTRAINT "CardTemplate_school_id_fkey" FOREIGN KEY ("school_id") REFERENCES "School"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Session" ADD CONSTRAINT "Session_parent_user_id_fkey" FOREIGN KEY ("parent_user_id") REFERENCES "ParentUser"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Session" ADD CONSTRAINT "Session_school_user_id_fkey" FOREIGN KEY ("school_user_id") REFERENCES "SchoolUser"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Session" ADD CONSTRAINT "Session_admin_user_id_fkey" FOREIGN KEY ("admin_user_id") REFERENCES "SuperAdmin"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ScanLog" ADD CONSTRAINT "ScanLog_token_id_fkey" FOREIGN KEY ("token_id") REFERENCES "Token"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ScanLog" ADD CONSTRAINT "ScanLog_school_id_fkey" FOREIGN KEY ("school_id") REFERENCES "School"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ScanAnomaly" ADD CONSTRAINT "ScanAnomaly_token_id_fkey" FOREIGN KEY ("token_id") REFERENCES "Token"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "LocationConsent" ADD CONSTRAINT "LocationConsent_student_id_fkey" FOREIGN KEY ("student_id") REFERENCES "Student"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "LocationEvent" ADD CONSTRAINT "LocationEvent_student_id_fkey" FOREIGN KEY ("student_id") REFERENCES "Student"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "LocationEvent" ADD CONSTRAINT "LocationEvent_school_id_fkey" FOREIGN KEY ("school_id") REFERENCES "School"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "LocationEvent" ADD CONSTRAINT "LocationEvent_token_id_fkey" FOREIGN KEY ("token_id") REFERENCES "Token"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "RegistrationNonce" ADD CONSTRAINT "RegistrationNonce_token_id_fkey" FOREIGN KEY ("token_id") REFERENCES "Token"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "TrustedScanZone" ADD CONSTRAINT "TrustedScanZone_school_id_fkey" FOREIGN KEY ("school_id") REFERENCES "School"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Notification" ADD CONSTRAINT "Notification_school_id_fkey" FOREIGN KEY ("school_id") REFERENCES "School"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Notification" ADD CONSTRAINT "Notification_student_id_fkey" FOREIGN KEY ("student_id") REFERENCES "Student"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Notification" ADD CONSTRAINT "Notification_parent_id_fkey" FOREIGN KEY ("parent_id") REFERENCES "ParentUser"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AuditLog" ADD CONSTRAINT "AuditLog_school_id_fkey" FOREIGN KEY ("school_id") REFERENCES "School"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ApiKey" ADD CONSTRAINT "ApiKey_school_id_fkey" FOREIGN KEY ("school_id") REFERENCES "School"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Webhook" ADD CONSTRAINT "Webhook_school_id_fkey" FOREIGN KEY ("school_id") REFERENCES "School"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "WebhookDelivery" ADD CONSTRAINT "WebhookDelivery_webhook_id_fkey" FOREIGN KEY ("webhook_id") REFERENCES "Webhook"("id") ON DELETE CASCADE ON UPDATE CASCADE;
