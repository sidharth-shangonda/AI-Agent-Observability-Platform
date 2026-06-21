import { Processor, WorkerHost } from '@nestjs/bullmq';
import { Job } from 'bullmq';
import { Inject, Logger } from '@nestjs/common';
import { randomUUID } from 'crypto';
import { SystemPrismaService } from '../prisma/system-prisma.service';
import { TelemetryTraceSchema } from './telemetry.schema';
import { TraceStatus, Prisma } from '@prisma/client';
import { PricingService } from './pricing.service';

@Processor('trace-ingestion')
export class TraceProcessor extends WorkerHost {
  private readonly logger = new Logger(TraceProcessor.name);

  constructor(
    @Inject(SystemPrismaService) private readonly systemPrisma: SystemPrismaService,
    @Inject(PricingService) private readonly pricingService: PricingService,
  ) {
    super();
  }

  async process(job: Job<any, any, string>): Promise<any> {
    const { rawTraceId, projectId, tenantId } = job.data;
    this.logger.log(`Starting trace processing job ${job.id} for rawTraceId: ${rawTraceId}`);

    // 1. Fetch raw trace payload
    const rawTrace = await this.systemPrisma.rawTrace.findUnique({
      where: { id: rawTraceId },
    });

    if (!rawTrace) {
      this.logger.error(`RawTrace record not found for id: ${rawTraceId}`);
      return;
    }

    try {
      // 2. Parse and validate using Zod
      const payloadResult = TelemetryTraceSchema.safeParse(rawTrace.payload);
      if (!payloadResult.success) {
        const errorMsg = `Payload validation failed: ${JSON.stringify(payloadResult.error.format())}`;
        this.logger.error(errorMsg);
        await this.systemPrisma.rawTrace.update({
          where: { id: rawTraceId },
          data: {
            status: TraceStatus.ERROR,
            error: errorMsg,
          },
        });
        return;
      }

      const payload = payloadResult.data;

      // 3. Process spans, normalize OTel metadata, calculate costs, and compile trace aggregates
      let tokensUsed = 0;
      let cost = 0;
      const spans = payload.spans;

      const traceDbId = randomUUID();

      const flatSpans = spans.map((span) => {
        let spanPromptTokens = 0;
        let spanCompletionTokens = 0;
        let spanCost = span.cost ?? 0;
        let tokenCountObj: any = span.tokenCount ?? null;

        if (span.type === 'LLM') {
          const metadata = span.metadata || {};

          // Extract token counts (OTel semantic conventions fallback)
          const promptVal = span.tokenCount?.prompt ?? 
            metadata['gen_ai.usage.prompt_tokens'] ?? 
            metadata['prompt_tokens'] ?? 
            metadata['usage.prompt_tokens'];

          const completionVal = span.tokenCount?.completion ?? 
            metadata['gen_ai.usage.completion_tokens'] ?? 
            metadata['completion_tokens'] ?? 
            metadata['usage.completion_tokens'];

          const parseTokens = (val: any): number => {
            if (typeof val === 'number') return val;
            if (typeof val === 'string') {
              const parsed = parseInt(val, 10);
              return isNaN(parsed) ? 0 : parsed;
            }
            return 0;
          };
          spanPromptTokens = parseTokens(promptVal);
          spanCompletionTokens = parseTokens(completionVal);

          if (spanPromptTokens > 0 || spanCompletionTokens > 0) {
            tokenCountObj = {
              prompt: spanPromptTokens,
              completion: spanCompletionTokens,
            };
            tokensUsed += (spanPromptTokens + spanCompletionTokens);
          }

          // Automatically calculate cost if not explicitly provided or is 0
          if (!spanCost || spanCost === 0) {
            const providerVal = metadata['gen_ai.system'] ?? metadata['provider'] ?? metadata['vendor'] ?? '';
            const modelVal = metadata['gen_ai.request.model'] ?? metadata['model'] ?? metadata['request.model'] ?? '';

            if (providerVal && modelVal && (spanPromptTokens > 0 || spanCompletionTokens > 0)) {
              spanCost = this.pricingService.calculateCost(
                String(providerVal),
                String(modelVal),
                spanPromptTokens,
                spanCompletionTokens,
              );
            }
          }
        }

        cost += spanCost;

        return {
          id: span.id,
          traceId: traceDbId,
          parentSpanId: span.parentSpanId || null,
          type: span.type,
          name: span.name,
          status: span.status,
          startTime: new Date(span.startTime),
          endTime: new Date(span.endTime),
          latencyMs: span.latencyMs ?? (new Date(span.endTime).getTime() - new Date(span.startTime).getTime()),
          input: span.input ?? Prisma.DbNull,
          output: span.output ?? Prisma.DbNull,
          tokenCount: tokenCountObj ?? Prisma.DbNull,
          cost: spanCost,
          metadata: span.metadata ?? Prisma.DbNull,
        };
      });

      let latencyMs = 0;
      if (spans.length > 0) {
        const startTimes = spans.map(s => new Date(s.startTime).getTime());
        const endTimes = spans.map(s => new Date(s.endTime).getTime());
        const minStart = Math.min(...startTimes);
        const maxEnd = Math.max(...endTimes);
        latencyMs = maxEnd - minStart;
      }

      // 5. Execute DB write in a transaction (with idempotency support)
      await this.systemPrisma.$transaction(async (tx) => {
        // Check if an AgentTrace with (projectId, externalTraceId) already exists
        const existingTrace = await tx.agentTrace.findUnique({
          where: {
            projectId_externalTraceId: {
              projectId,
              externalTraceId: payload.id,
            },
          },
        });

        if (existingTrace) {
          this.logger.log('Duplicate trace found for externalTraceId: ' + payload.id + '. Deleting existing trace.');
          // Delete the existing trace (Cascade constraints delete associated Spans)
          await tx.agentTrace.delete({
            where: { id: existingTrace.id },
          });
        }

        // Create the new AgentTrace
        await tx.agentTrace.create({
          data: {
            id: traceDbId,
            projectId,
            externalTraceId: payload.id,
            name: payload.name,
            status: payload.status,
            metadata: payload.metadata ?? Prisma.DbNull,
            tokensUsed,
            cost,
            latencyMs,
          },
        });

        await tx.agentSpan.createMany({
          data: flatSpans,
        });

        // Update RawTrace status to SUCCESS
        await tx.rawTrace.update({
          where: { id: rawTraceId },
          data: {
            status: TraceStatus.SUCCESS,
            error: null,
          },
        });
      });

      this.logger.log(`Trace processing job ${job.id} succeeded for rawTraceId: ${rawTraceId}`);

    } catch (err: any) {
      const errorMsg = `Error processing trace: ${err.message || err}\n${err.stack || ''}`;
      this.logger.error(errorMsg);

      // Update RawTrace status to ERROR
      try {
        await this.systemPrisma.rawTrace.update({
          where: { id: rawTraceId },
          data: {
            status: TraceStatus.ERROR,
            error: errorMsg,
          },
        });
      } catch (updateErr) {
        this.logger.error(`Failed to update RawTrace status to ERROR: ${updateErr}`);
      }

      // Rethrow error so BullMQ marks it as failed and retries
      throw err;
    }
  }
}
