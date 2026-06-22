import { z } from 'zod';

export const MemoryStoreSchema = z.object({
  id: z.string().uuid('Memory id must be a valid UUID').optional(),
  content: z.string().min(1, 'Content cannot be empty'),
  embedding: z.array(z.number()).length(1536, 'Embedding must be a 1536-dimensional float vector'),
  metadata: z.record(z.string(), z.any()).optional(),
});

export const MemorySearchSchema = z.object({
  embedding: z.array(z.number()).length(1536, 'Embedding must be a 1536-dimensional float vector'),
  limit: z.number().int().min(1).max(50).default(10).optional(),
  minSimilarity: z.number().min(-1.0).max(1.0).default(0.0).optional(),
});

export type MemoryStoreDto = z.infer<typeof MemoryStoreSchema>;
export type MemorySearchDto = z.infer<typeof MemorySearchSchema>;
