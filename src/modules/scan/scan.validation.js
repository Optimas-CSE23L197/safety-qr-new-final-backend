import { z } from 'zod';

const scanCodeRegex = /^[A-Za-z0-9]{43}$/;

export const scanCodeSchema = z.object({
  code: z.string().regex(scanCodeRegex, 'Invalid scan code format'),
});

export const scanEventSchema = z
  .object({
    code: z.string().regex(scanCodeRegex, 'Invalid scan code'),

    device_type: z.enum(['ANDROID', 'IOS', 'WEB']).optional(),

    latitude: z.number().min(-90).max(90).optional(),

    longitude: z.number().min(-180).max(180).optional(),

    accuracy: z.number().positive().optional(),

    user_agent: z.string().max(500).optional(),
  })
  .strict();
