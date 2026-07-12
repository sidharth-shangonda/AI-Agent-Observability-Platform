import { Injectable, Inject, Logger } from '@nestjs/common';
import { InjectQueue } from '@nestjs/bullmq';
import { Queue } from 'bullmq';
import { Registry, Counter, Histogram, Gauge } from 'prom-client';

@Injectable()
export class MetricsService {
  private readonly logger = new Logger(MetricsService.name);
  private readonly registry = new Registry();

  // Define Prometheus Metrics
  private readonly tracesIngestedCounter: Counter<string>;
  private readonly spansCounter: Counter<string>;
  private readonly tokensCounter: Counter<string>;
  private readonly costCounter: Counter<string>;
  private readonly traceLatencyHistogram: Histogram<string>;
  private readonly queueJobsGauge: Gauge<string>;

  constructor(
    @InjectQueue('trace-ingestion') private readonly traceQueue: Queue,
    @InjectQueue('webhook-delivery') private readonly webhookQueue: Queue,
  ) {
    // 1. Ingested Traces Counter
    this.tracesIngestedCounter = new Counter({
      name: 'observability_traces_ingested_total',
      help: 'Total number of traces ingested and processed',
      labelNames: ['tenant_id', 'project_id', 'status'],
      registers: [this.registry],
    });

    // 2. Ingested Spans Counter
    this.spansCounter = new Counter({
      name: 'observability_spans_total',
      help: 'Total number of processed trace spans by type',
      labelNames: ['tenant_id', 'project_id', 'type'],
      registers: [this.registry],
    });

    // 3. Token Count Counter
    this.tokensCounter = new Counter({
      name: 'observability_tokens_total',
      help: 'Total LLM prompt and completion tokens used',
      labelNames: ['tenant_id', 'project_id', 'type'],
      registers: [this.registry],
    });

    // 4. Cumulative LLM Cost Counter
    this.costCounter = new Counter({
      name: 'observability_cost_usd_total',
      help: 'Total estimated dollar cost of LLM inference',
      labelNames: ['tenant_id', 'project_id'],
      registers: [this.registry],
    });

    // 5. Trace Latency Histogram
    this.traceLatencyHistogram = new Histogram({
      name: 'observability_trace_latency_ms',
      help: 'Trace execution latency in milliseconds',
      labelNames: ['tenant_id', 'project_id'],
      buckets: [50, 100, 250, 500, 1000, 2500, 5000, 10000, 30000],
      registers: [this.registry],
    });

    // 6. BullMQ Queue Status Gauge
    this.queueJobsGauge = new Gauge({
      name: 'observability_queue_jobs_total',
      help: 'Current BullMQ backlog count categorized by queue name and status',
      labelNames: ['queue_name', 'status'],
      registers: [this.registry],
    });
  }

  // Record Ingested Trace Metrics
  trackTraceIngested(tenantId: string, projectId: string, status: string) {
    this.tracesIngestedCounter.inc({ tenant_id: tenantId, project_id: projectId, status });
  }

  // Record Span Type Count Metrics
  trackSpan(tenantId: string, projectId: string, type: string) {
    this.spansCounter.inc({ tenant_id: tenantId, project_id: projectId, type });
  }

  // Record Token Usage Metrics
  trackTokens(tenantId: string, projectId: string, type: 'prompt' | 'completion', count: number) {
    this.tokensCounter.inc({ tenant_id: tenantId, project_id: projectId, type }, count);
  }

  // Record LLM Cost Metrics
  trackCost(tenantId: string, projectId: string, cost: number) {
    this.costCounter.inc({ tenant_id: tenantId, project_id: projectId }, cost);
  }

  // Record Trace Execution Latency Metrics
  trackTraceLatency(tenantId: string, projectId: string, latencyMs: number) {
    this.traceLatencyHistogram.observe({ tenant_id: tenantId, project_id: projectId }, latencyMs);
  }

  // Pull job counts from BullMQ queues dynamically on scraping metrics
  async updateQueueMetrics(): Promise<void> {
    try {
      const traceJobCounts = await this.traceQueue.getJobCounts();
      const webhookJobCounts = await this.webhookQueue.getJobCounts();

      const updateGaugesForQueue = (queueName: string, counts: any) => {
        this.queueJobsGauge.set({ queue_name: queueName, status: 'waiting' }, counts.waiting);
        this.queueJobsGauge.set({ queue_name: queueName, status: 'active' }, counts.active);
        this.queueJobsGauge.set({ queue_name: queueName, status: 'completed' }, counts.completed);
        this.queueJobsGauge.set({ queue_name: queueName, status: 'failed' }, counts.failed);
        this.queueJobsGauge.set({ queue_name: queueName, status: 'delayed' }, counts.delayed);
      };

      updateGaugesForQueue('trace-ingestion', traceJobCounts);
      updateGaugesForQueue('webhook-delivery', webhookJobCounts);
    } catch (err: any) {
      this.logger.error(`Failed to update BullMQ queue metrics: ${err.message || err}`);
    }
  }

  // Content type for Prometheus scraper headers
  getMetricsContentType(): string {
    return this.registry.contentType;
  }

  // Export all registered metrics in Prometheus text exposition format
  async getMetricsAsString(): Promise<string> {
    return this.registry.metrics();
  }
}
