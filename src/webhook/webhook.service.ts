import { Injectable, Inject, NotFoundException } from '@nestjs/common';
import { InjectQueue } from '@nestjs/bullmq';
import { Queue } from 'bullmq';
import { PrismaService } from '../prisma/prisma.service';
import { SystemPrismaService } from '../prisma/system-prisma.service';
import { CreateWebhookDto } from './webhook.schema';

@Injectable()
export class WebhookService {
  constructor(
    @InjectQueue('webhook-delivery') private readonly webhookQueue: Queue,
    @Inject(PrismaService) private readonly prisma: PrismaService,
    @Inject(SystemPrismaService) private readonly systemPrisma: SystemPrismaService,
  ) {}

  // 1. Create a Webhook Endpoint config (RLS Enforced)
  async createEndpoint(projectId: string, dto: CreateWebhookDto) {
    return this.prisma.client.webhookEndpoint.create({
      data: {
        projectId,
        url: dto.url,
        secret: dto.secret,
        events: dto.events,
        isActive: true,
      },
    });
  }

  // 2. List Webhook Endpoint configs (RLS Enforced)
  async listEndpoints(projectId: string) {
    return this.prisma.client.webhookEndpoint.findMany({
      where: { projectId },
    });
  }

  // 3. Delete a Webhook Endpoint config (RLS Enforced)
  async deleteEndpoint(projectId: string, id: string) {
    // We first check if the endpoint exists to throw a clean 404
    const endpoint = await this.prisma.client.webhookEndpoint.findFirst({
      where: { id, projectId },
    });

    if (!endpoint) {
      throw new NotFoundException(`Webhook endpoint with ID ${id} not found`);
    }

    return this.prisma.client.webhookEndpoint.delete({
      where: { id },
    });
  }

  // 4. Dispatch Anomaly Event (RLS Bypassed - called by background TraceProcessor)
  async dispatchAnomalyEvent(projectId: string, evaluationResult: any) {
    // Fetch active endpoints that subscribe to "anomaly.detected"
    // Since this is run by the background processor, we use systemPrisma to bypass RLS session set configs
    const activeEndpoints = await this.systemPrisma.webhookEndpoint.findMany({
      where: {
        projectId,
        isActive: true,
      },
    });

    const matchingEndpoints = activeEndpoints.filter((ep) => {
      try {
        const events = Array.isArray(ep.events) ? ep.events : JSON.parse(ep.events as string);
        return events.includes('anomaly.detected');
      } catch (err) {
        return false;
      }
    });

    for (const ep of matchingEndpoints) {
      const payload = {
        event: 'anomaly.detected',
        timestamp: new Date().toISOString(),
        projectId,
        anomaly: {
          id: evaluationResult.id,
          spanId: evaluationResult.spanId,
          detectorName: evaluationResult.detectorName,
          severity: evaluationResult.severity,
          reason: evaluationResult.reason,
          metadata: evaluationResult.metadata,
        },
      };

      // Create WebhookOutbox logging row (PENDING)
      const outbox = await this.systemPrisma.webhookOutbox.create({
        data: {
          endpointId: ep.id,
          eventType: 'anomaly.detected',
          payload,
          status: 'PENDING',
          attempts: 0,
        },
      });

      // Add to BullMQ queue for background retry-resilient delivery
      await this.webhookQueue.add(
        'deliver-webhook',
        { outboxId: outbox.id },
        {
          jobId: outbox.id, // Enforce outbox-level deduplication
          removeOnComplete: true,
          removeOnFail: false,
        },
      );
    }
  }
}
