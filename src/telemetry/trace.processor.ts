import { Processor, WorkerHost } from '@nestjs/bullmq';
import { Job } from 'bullmq';
import { Inject, Logger } from '@nestjs/common';
import { SystemPrismaService } from '../prisma/system-prisma.service';
import { TelemetryTraceSchema } from './telemetry.schema';
import { TraceStatus, Prisma } from '@prisma/client';

@Processor('trace-ingestion')
export class TraceProcessor extends WorkerHost {
  private readonly logger = new Logger(TraceProcessor.name);

  constructor(
    @Inject(SystemPrismaService) private readonly systemPrisma: SystemPrismaService,
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

      // 3. Calculate aggregate metrics
      let tokensUsed = 0;
      let cost = 0;
      const spans = payload.spans;

      for (const span of spans) {
        if (span.tokenCount) {
          tokensUsed += (span.tokenCount.prompt ?? 0) + (span.tokenCount.completion ?? 0);
        }
        if (span.cost) {
          cost += span.cost;
        }
      }

      let latencyMs = 0;
      if (spans.length > 0) {
        const startTimes = spans.map(s => new Date(s.startTime).getTime());
        const endTimes = spans.map(s => new Date(s.endTime).getTime());
        const minStart = Math.min(...startTimes);
        const maxEnd = Math.max(...endTimes);
        latencyMs = maxEnd - minStart;
      }

      // 4. Construct parent-child span trees
      const spanMap = new Map<string, any>();
      for (const span of spans) {
        spanMap.set(span.id, { ...span, children: [] });
      }

      const rootSpans: any[] = [];
      for (const span of spanMap.values()) {
        if (span.parentSpanId && spanMap.has(span.parentSpanId)) {
          spanMap.get(span.parentSpanId).children.push(span);
        } else {
          rootSpans.push(span);
        }
      }

      // Recursive mapper to build Prisma's nested create structure
      const mapSpanToPrisma = (span: any): any => {
        return {
          id: span.id,
          type: span.type,
          name: span.name,
          status: span.status,
          startTime: new Date(span.startTime),
          endTime: new Date(span.endTime),
          latencyMs: span.latencyMs ?? (new Date(span.endTime).getTime() - new Date(span.startTime).getTime()),
          input: span.input ?? Prisma.DbNull,
          output: span.output ?? Prisma.DbNull,
          tokenCount: span.tokenCount ?? Prisma.DbNull,
          cost: span.cost ?? 0,
          metadata: span.metadata ?? Prisma.DbNull,
          childSpans: span.children.length > 0 ? {
            create: span.children.map(mapSpanToPrisma),
          } : undefined,
        };
      };

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
          this.logger.log(`Duplicate trace found for externalTraceId: ${payload.id}. Deleting existing trace.`);
          // Delete the existing trace (Cascade constraints delete associated Spans)
          await tx.agentTrace.delete({
            where: { id: existingTrace.id },
          });
        }

        // Create the new AgentTrace and nested Spans
        await tx.agentTrace.create({
          data: {
            projectId,
            externalTraceId: payload.id,
            name: payload.name,
            status: payload.status,
            metadata: payload.metadata ?? Prisma.DbNull,
            tokensUsed,
            cost,
            latencyMs,
            spans: {
              create: rootSpans.map(mapSpanToPrisma),
            },
          },
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
