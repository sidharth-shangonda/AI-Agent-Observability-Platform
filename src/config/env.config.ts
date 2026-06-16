import { z } from 'zod';

export const envSchema = z.object({
  NODE_ENV: z.enum(['development', 'production', 'test']).default('development'),
  PORT: z.coerce.number().default(3000),
  DATABASE_URL: z.string().url('DATABASE_URL must be a valid connection URL'),
  SYSTEM_DATABASE_URL: z.string().url('SYSTEM_DATABASE_URL must be a valid connection URL'),
  REDIS_HOST: z.string().default('localhost'),
  REDIS_PORT: z.coerce.number().default(6379),
});

export type Env = z.infer<typeof envSchema>;

export function validateConfig(config: Record<string, unknown>): Env {
  const result = envSchema.safeParse(config);

  if (!result.success) {
    console.error('❌ Invalid environment configuration:');
    console.error(JSON.stringify(result.error.format(), null, 2));
    throw new Error('Environment validation failed');
  }

  return result.data;
}
