import { Controller, Post, Body, UseGuards, Inject, HttpCode, HttpStatus, BadRequestException } from '@nestjs/common';
import { ApiKeyGuard } from '../common/guards/api-key.guard';
import { CurrentContext, RequestContextData } from '../common/decorators/current-context.decorator';
import { PrismaService } from '../prisma/prisma.service';
import { InjectQueue } from '@nestjs/bullmq';
import { Queue } from 'bullmq';
import { TelemetryTraceSchema } from './telemetry.schema';
import { TraceStatus } from '@prisma/client';

@Controller('v1/traces')
@UseGuards(ApiKeyGuard)
export class TelemetryController {
  constructor(
    @InjectQueue('trace-ingestion') private readonly traceQueue: Queue,
    @Inject(PrismaService) private readonly prismaService: PrismaService,
  ) {}

  @Post()
  @HttpCode(HttpStatus.ACCEPTED)
  async ingestTraces(
    @Body() body: any,
    @CurrentContext() context: RequestContextData,
  ) {
    const result = TelemetryTraceSchema.safeParse(body);
    if (!result.success) {
      throw new BadRequestException({
        message: 'Telemetry payload validation failed',
        errors: result.error.format(),
      });
    }

    // 1. Log raw trace payload to database under current project RLS boundary
    const rawTrace = await this.prismaService.client.rawTrace.create({
      data: {
        projectId: context.projectId,
        payload: body,
        status: TraceStatus.PENDING,
      },
    });

    // 2. Enqueue the trace processing job
    await this.traceQueue.add(
      'process-trace',
      {
        rawTraceId: rawTrace.id,
        projectId: context.projectId,
        tenantId: context.tenantId,
      },
      {
        jobId: rawTrace.id, // Use rawTraceId as BullMQ jobId to enforce deduplication/traceability
      },
    );

    return {
      status: 'accepted',
      rawTraceId: rawTrace.id,
    };
  }
}
