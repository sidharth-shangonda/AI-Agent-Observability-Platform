import { Processor, WorkerHost } from '@nestjs/bullmq';
import { Job, Queue } from 'bullmq';
import { Inject, Logger } from '@nestjs/common';
import { InjectQueue } from '@nestjs/bullmq';
import { SystemPrismaService } from '../prisma/system-prisma.service';
import * as crypto from 'crypto';

@Processor('webhook-delivery')
export class WebhookProcessor extends WorkerHost {
  private readonly logger = new Logger(WebhookProcessor.name);

  constructor(
    @Inject(SystemPrismaService) private readonly systemPrisma: SystemPrismaService,
    @InjectQueue('webhook-delivery') private readonly webhookQueue: Queue,
  ) {
    super();
  }

  async process(job: Job<any, any, string>): Promise<any> {
    const { outboxId } = job.data;
    this.logger.log(`Starting webhook delivery job ${job.id} for outboxId: ${outboxId}`);

    const outbox = await this.systemPrisma.webhookOutbox.findUnique({
      where: { id: outboxId },
      include: { endpoint: true },
    });

    if (!outbox) {
      this.logger.error(`WebhookOutbox record not found for id: ${outboxId}`);
      return;
    }

    if (!outbox.endpoint || !outbox.endpoint.isActive) {
      this.logger.warn(`WebhookEndpoint not found or inactive for outboxId: ${outboxId}`);
      await this.systemPrisma.webhookOutbox.update({
        where: { id: outboxId },
        data: {
          status: 'FAILED',
          error: 'Endpoint not found or is inactive',
        },
      });
      return;
    }

    const payloadString = JSON.stringify(outbox.payload);

    // Compute HMAC-SHA256 signature
    const signature = crypto
      .createHmac('sha256', outbox.endpoint.secret)
      .update(payloadString)
      .digest('hex');

    const currentAttempts = outbox.attempts + 1;
    let success = false;
    let errorDetail = '';

    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), 5000); // 5 seconds timeout limit

    try {
      const response = await fetch(outbox.endpoint.url, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'X-Webhook-Signature': signature,
        },
        body: payloadString,
        signal: controller.signal,
      });

      if (response.ok) {
        success = true;
      } else {
        errorDetail = `HTTP Error ${response.status}: ${response.statusText}`;
      }
    } catch (err: any) {
      if (err.name === 'AbortError') {
        errorDetail = 'Request timed out after 5000ms';
      } else {
        errorDetail = err.message || String(err);
      }
    } finally {
      clearTimeout(timeoutId);
    }

    if (success) {
      this.logger.log(`Successfully delivered webhook for outboxId: ${outboxId} on attempt ${currentAttempts}`);
      await this.systemPrisma.webhookOutbox.update({
        where: { id: outboxId },
        data: {
          status: 'SENT',
          attempts: currentAttempts,
          error: null,
        },
      });
    } else {
      this.logger.warn(`Failed to deliver webhook for outboxId: ${outboxId} on attempt ${currentAttempts}. Error: ${errorDetail}`);

      if (currentAttempts < 5) {
        // Calculate backoff delay: 2^attempts * 1000 ms (2s, 4s, 8s, 16s)
        const backoffDelay = Math.pow(2, currentAttempts) * 1000;
        const nextRetryAt = new Date(Date.now() + backoffDelay);

        await this.systemPrisma.webhookOutbox.update({
          where: { id: outboxId },
          data: {
            status: 'PENDING',
            attempts: currentAttempts,
            error: errorDetail,
            nextRetryAt,
          },
        });

        // Re-enqueue job to BullMQ queue with delay parameter
        await this.webhookQueue.add(
          'deliver-webhook',
          { outboxId },
          {
            jobId: `${outboxId}-retry-${currentAttempts}`, // unique retry Job ID to enforce idempotency
            delay: backoffDelay,
            removeOnComplete: true,
            removeOnFail: false,
          },
        );
      } else {
        this.logger.error(`Max webhook delivery attempts reached (5) for outboxId: ${outboxId}. Setting status to FAILED.`);
        await this.systemPrisma.webhookOutbox.update({
          where: { id: outboxId },
          data: {
            status: 'FAILED',
            attempts: currentAttempts,
            error: `Max delivery attempts reached. Last error: ${errorDetail}`,
          },
        });
      }
    }
  }
}
