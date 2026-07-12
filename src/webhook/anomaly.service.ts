import { Injectable, Inject, Logger } from '@nestjs/common';
import { SystemPrismaService } from '../prisma/system-prisma.service';
import { WebhookService } from './webhook.service';
import { Severity } from '@prisma/client';

@Injectable()
export class AnomalyService {
  private readonly logger = new Logger(AnomalyService.name);

  constructor(
    @Inject(SystemPrismaService) private readonly systemPrisma: SystemPrismaService,
    @Inject(WebhookService) private readonly webhookService: WebhookService,
  ) {}

  // Evaluates processed spans for anomalies (Cost, Latency, and Status Errors)
  async evaluateSpans(spans: any[], projectId: string): Promise<void> {
    this.logger.log(`Evaluating ${spans.length} spans for anomalies in project: ${projectId}`);

    for (const span of spans) {
      const anomalies: Array<{ detector: string; severity: Severity; reason: string }> = [];

      // 1. Model Error Anomaly (CRITICAL severity)
      if (span.status === 'ERROR') {
        anomalies.push({
          detector: 'model_error',
          severity: Severity.CRITICAL,
          reason: 'Span execution completed with error status',
        });
      }

      // 2. Latency Spike Anomaly (MEDIUM severity, threshold: 5000ms)
      if (span.latencyMs > 5000) {
        anomalies.push({
          detector: 'latency_spike',
          severity: Severity.MEDIUM,
          reason: `Span latency of ${span.latencyMs}ms exceeded the latency limit threshold of 5000ms`,
        });
      }

      // 3. Cost Spike Anomaly (HIGH severity, threshold: $0.010)
      if (span.type === 'LLM' && span.cost) {
        const spanCost = typeof span.cost === 'number' ? span.cost : Number(span.cost);
        if (spanCost > 0.010) {
          anomalies.push({
            detector: 'token_cost_spike',
            severity: Severity.HIGH,
            reason: `LLM span cost of $${spanCost.toFixed(6)} exceeded the cost limit threshold of $0.010`,
          });
        }
      }

      // Record any detected anomalies in the database and trigger webhooks
      for (const anomaly of anomalies) {
        this.logger.warn(`Anomaly detected [${anomaly.detector}] on span: ${span.id}`);

        try {
          const evaluationResult = await this.systemPrisma.evaluationResult.create({
            data: {
              spanId: span.id,
              detectorName: anomaly.detector,
              severity: anomaly.severity,
              reason: anomaly.reason,
              metadata: {
                cost: span.cost,
                latencyMs: span.latencyMs,
                status: span.status,
              },
            },
          });

          // Dispatch outbox entries and queue BullMQ delivery jobs
          await this.webhookService.dispatchAnomalyEvent(projectId, evaluationResult);
        } catch (err: any) {
          this.logger.error(`Failed to record evaluation anomaly for span ${span.id}: ${err.message || err}`);
        }
      }
    }
  }
}
