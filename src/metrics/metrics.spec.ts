import { Test, TestingModule } from '@nestjs/testing';
import { FastifyAdapter, NestFastifyApplication } from '@nestjs/platform-fastify';
import { AppModule } from '../app.module';
import { getQueueToken } from '@nestjs/bullmq';
import { SystemPrismaService } from '../prisma/system-prisma.service';
import { TraceProcessor } from '../telemetry/trace.processor';
import { MetricsService } from './metrics.service';

describe('Prometheus Metrics Integration Tests (Phase 7)', () => {
  let app: NestFastifyApplication;
  let systemPrisma: SystemPrismaService;
  let traceProcessor: TraceProcessor;
  let metricsService: MetricsService;

  // Mock BullMQ queues with connection connection configs to prevent connection errors
  const mockTraceQueue = {
    add: jest.fn().mockResolvedValue({ id: 'mock-trace-job-id' }),
    getJobCounts: jest.fn().mockResolvedValue({
      waiting: 2,
      active: 1,
      completed: 10,
      failed: 0,
      delayed: 0,
    }),
    opts: {
      connection: {
        host: process.env.REDIS_HOST || 'localhost',
        port: Number(process.env.REDIS_PORT) || 6379,
      },
    },
  };

  const mockWebhookQueue = {
    add: jest.fn().mockResolvedValue({ id: 'mock-webhook-job-id' }),
    getJobCounts: jest.fn().mockResolvedValue({
      waiting: 0,
      active: 0,
      completed: 5,
      failed: 1,
      delayed: 0,
    }),
    opts: {
      connection: {
        host: process.env.REDIS_HOST || 'localhost',
        port: Number(process.env.REDIS_PORT) || 6379,
      },
    },
  };

  beforeAll(async () => {
    const moduleFixture: TestingModule = await Test.createTestingModule({
      imports: [AppModule],
    })
      .overrideProvider(getQueueToken('trace-ingestion'))
      .useValue(mockTraceQueue)
      .overrideProvider(getQueueToken('webhook-delivery'))
      .useValue(mockWebhookQueue)
      .compile();

    app = moduleFixture.createNestApplication<NestFastifyApplication>(new FastifyAdapter());
    await app.init();
    await app.getHttpAdapter().getInstance().ready();

    systemPrisma = app.get(SystemPrismaService);
    traceProcessor = app.get(TraceProcessor);
    metricsService = app.get(MetricsService);
  });

  afterAll(async () => {
    // Delete data created during test
    await systemPrisma.agentSpan.deleteMany({
      where: { id: 'span-metrics-test-101' },
    });
    await systemPrisma.agentTrace.deleteMany({
      where: { externalTraceId: 'trace-metrics-ext-101' },
    });
    await systemPrisma.rawTrace.deleteMany({
      where: { id: 'trace-metrics-raw-uuid' },
    });

    await app.close();
  });

  it('1. GET /metrics should return 200 and export prometheus metrics format', async () => {
    const response = await app.getHttpAdapter().getInstance().inject({
      method: 'GET',
      url: '/metrics',
    });

    expect(response.statusCode).toBe(200);
    expect(response.headers['content-type']).toContain('text/plain');
    expect(response.payload).toContain('observability_queue_jobs_total');
  });

  it('2. Ingesting traces should increment Prometheus metrics counters and histograms', async () => {
    // Fetch production project scope for label matching
    const project = await systemPrisma.project.findFirst({
      where: { name: 'Production AI Agent' },
    });
    expect(project).toBeDefined();

    // Create raw trace payload with tokens and cost metadata
    const rawTraceId = 'trace-metrics-raw-uuid';
    const rawTrace = await systemPrisma.rawTrace.create({
      data: {
        id: rawTraceId,
        projectId: project!.id,
        status: 'PENDING',
        payload: {
          id: 'trace-metrics-ext-101',
          name: 'Metrics Test Trace',
          status: 'SUCCESS',
          spans: [
            {
              id: 'span-metrics-test-101',
              type: 'LLM',
              name: 'metrics-llm-span',
              status: 'SUCCESS',
              startTime: '2026-07-12T12:00:00.000Z',
              endTime: '2026-07-12T12:00:02.000Z', // 2000ms latency
              cost: 0.005,
              tokenCount: {
                prompt: 500,
                completion: 200,
              },
            },
          ],
        },
      },
    });

    // Manually run trace processor
    const mockJob = {
      id: 'mock-trace-ingestion-job-metrics',
      data: {
        rawTraceId: rawTrace.id,
        projectId: project!.id,
        tenantId: project!.tenantId,
      },
    } as any;

    await traceProcessor.process(mockJob);

    // Call GET /metrics to verify exported string values
    const response = await app.getHttpAdapter().getInstance().inject({
      method: 'GET',
      url: '/metrics',
    });

    const payload = response.payload;

    // Verify Trace Ingested metrics with label matching
    const expectedTraceMetric = `observability_traces_ingested_total{tenant_id="${project!.tenantId}",project_id="${project!.id}",status="SUCCESS"} 1`;
    expect(payload).toContain(expectedTraceMetric);

    // Verify Span Type metrics
    const expectedSpanMetric = `observability_spans_total{tenant_id="${project!.tenantId}",project_id="${project!.id}",type="LLM"} 1`;
    expect(payload).toContain(expectedSpanMetric);

    // Verify Token usage metrics
    const expectedPromptTokens = `observability_tokens_total{tenant_id="${project!.tenantId}",project_id="${project!.id}",type="prompt"} 500`;
    const expectedCompletionTokens = `observability_tokens_total{tenant_id="${project!.tenantId}",project_id="${project!.id}",type="completion"} 200`;
    expect(payload).toContain(expectedPromptTokens);
    expect(payload).toContain(expectedCompletionTokens);

    // Verify Cost metrics
    const expectedCostMetric = `observability_cost_usd_total{tenant_id="${project!.tenantId}",project_id="${project!.id}"} 0.005`;
    expect(payload).toContain(expectedCostMetric);

    // Verify Latency metrics histogram
    expect(payload).toContain(`observability_trace_latency_ms_count{tenant_id="${project!.tenantId}",project_id="${project!.id}"} 1`);

    // Verify Queue Job metrics (retrieved dynamically from getJobCounts mocked queue values)
    expect(payload).toContain('observability_queue_jobs_total{queue_name="trace-ingestion",status="waiting"} 2');
    expect(payload).toContain('observability_queue_jobs_total{queue_name="trace-ingestion",status="active"} 1');
    expect(payload).toContain('observability_queue_jobs_total{queue_name="webhook-delivery",status="failed"} 1');
  });
});
