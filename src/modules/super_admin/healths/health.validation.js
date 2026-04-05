// =============================================================================
// health.validation.js — RESQID Super Admin
// Zod schemas for incident management endpoints
// Service checks have no request body — no schema needed for them
// =============================================================================

import { z } from 'zod';

// Valid service IDs — must match SERVICE_DEFINITIONS in health.service.js
export const SERVICE_IDS = ['api', 'db', 'redis', 'qr', 'notif', 'sms', 'storage', 'email'];

// ─── Incident Schemas ─────────────────────────────────────────────────────────

export const createIncidentSchema = z.object({
  title: z
    .string({ required_error: 'Title is required' })
    .min(5, 'Title must be at least 5 characters')
    .max(200, 'Title too long'),

  severity: z.enum(['LOW', 'MEDIUM', 'HIGH', 'CRITICAL'], {
    required_error: 'Severity is required',
    invalid_type_error: 'Severity must be LOW, MEDIUM, HIGH, or CRITICAL',
  }),

  affected_services: z
    .array(z.enum(SERVICE_IDS, { invalid_type_error: 'Invalid service ID' }))
    .min(1, 'At least one affected service is required'),

  message: z
    .string({ required_error: 'Message is required' })
    .min(10, 'Message must be at least 10 characters')
    .max(2000, 'Message too long'),
});

export const updateIncidentSchema = z
  .object({
    status: z
      .enum(['INVESTIGATING', 'IDENTIFIED', 'MONITORING', 'RESOLVED'], {
        invalid_type_error: 'Invalid status',
      })
      .optional(),

    severity: z
      .enum(['LOW', 'MEDIUM', 'HIGH', 'CRITICAL'], {
        invalid_type_error: 'Invalid severity',
      })
      .optional(),

    message: z
      .string()
      .min(10, 'Update message must be at least 10 characters')
      .max(2000)
      .optional(),
  })
  .refine(data => Object.values(data).some(v => v !== undefined), {
    message: 'At least one field (status, severity, or message) is required',
  });

export const listIncidentsQuerySchema = z.object({
  status: z
    .enum(['INVESTIGATING', 'IDENTIFIED', 'MONITORING', 'RESOLVED', 'ALL'])
    .optional()
    .default('ALL'),
  active_only: z
    .string()
    .optional()
    .transform(v => v === 'true'),
});