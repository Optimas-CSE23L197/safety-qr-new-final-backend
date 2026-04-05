import { z } from 'zod';

const scanCodeRegex = /^[A-Za-z0-9]{43}$/;

export const scanCodeSchema = z.object({
  code: z.string().regex(scanCodeRegex, 'Invalid scan code format'),
});

// Reserved for future use (POST scan endpoint with location data)
export const scanEventSchema = z
  .object({
    code: z.string().regex(scanCodeRegex, 'Invalid scan code format'),
    device_type: z.enum(['ANDROID', 'IOS', 'WEB']).optional(),
    latitude: z.number().min(-90).max(90).optional(),
    longitude: z.number().min(-180).max(180).optional(),
    accuracy: z.number().positive().max(1000).optional(),
    user_agent: z.string().max(500).optional(),
  })
  .strict()
  .refine(data => (data.latitude !== undefined) === (data.longitude !== undefined), {
    message: 'Both latitude and longitude must be provided together',
  });
