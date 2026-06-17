import { z } from 'zod';
import { SpanType, TraceStatus } from '@prisma/client';

export const TelemetrySpanSchema = z.object({
  id: z.string().uuid('Span id must be a valid UUID'),
  parentSpanId: z.string().uuid('parentSpanId must be a valid UUID').nullable().optional(),
  type: z.nativeEnum(SpanType),
  name: z.string().min(1, 'Span name cannot be empty'),
  status: z.nativeEnum(TraceStatus).default(TraceStatus.SUCCESS),
  startTime: z.string().datetime({ message: 'startTime must be a valid ISO datetime string' }),
  endTime: z.string().datetime({ message: 'endTime must be a valid ISO datetime string' }),
  input: z.any().optional(),
  output: z.any().optional(),
  tokenCount: z
    .object({
      prompt: z.number().int().nonnegative().optional(),
      completion: z.number().int().nonnegative().optional(),
    })
    .optional(),
  cost: z.number().nonnegative().optional(),
  metadata: z.record(z.string(), z.any()).optional(),
});

export const TelemetryTraceSchema = z.object({
  id: z.string().min(1, 'Trace external ID cannot be empty'),
  name: z.string().min(1, 'Trace name cannot be empty'),
  status: z.nativeEnum(TraceStatus).default(TraceStatus.SUCCESS),
  metadata: z.record(z.string(), z.any()).optional(),
  spans: z.array(TelemetrySpanSchema),
});

export type TelemetrySpan = z.infer<typeof TelemetrySpanSchema>;
export type TelemetryTrace = z.infer<typeof TelemetryTraceSchema>;
