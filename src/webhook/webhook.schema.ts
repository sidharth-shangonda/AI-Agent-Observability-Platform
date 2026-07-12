import { z } from 'zod';

export const CreateWebhookSchema = z.object({
  url: z.string().url('Invalid webhook endpoint URL'),
  secret: z.string().min(16, 'HMAC secret must be at least 16 characters long'),
  events: z.array(z.enum(['anomaly.detected'])).min(1, 'At least one event subscription is required'),
});

export type CreateWebhookDto = z.infer<typeof CreateWebhookSchema>;
