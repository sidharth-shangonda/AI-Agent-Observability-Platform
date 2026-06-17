import { Test, TestingModule } from '@nestjs/testing';
import { FastifyAdapter, NestFastifyApplication } from '@nestjs/platform-fastify';
import { AppModule } from '../app.module';
import { getQueueToken } from '@nestjs/bullmq';
import { SystemPrismaService } from '../prisma/system-prisma.service';
import { TraceProcessor } from './trace.processor';
import { TraceStatus, SpanType } from '@prisma/client';

describe('Telemetry Ingestion & Processing Integration Tests (Phase 3)', () => {
  let app: NestFastifyApplication;
  let systemPrisma: SystemPrismaService;
  let processor: TraceProcessor;
  const mockQueue = {
    add: jest.fn().mockResolvedValue({ id: 'mock-job-id' }),
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
      .useValue(mockQueue)
      .compile();

    app = moduleFixture.createNestApplication<NestFastifyApplication>(new FastifyAdapter());
    await app.init();
    await app.getHttpAdapter().getInstance().ready();

    systemPrisma = app.get(SystemPrismaService);
    processor = app.get(TraceProcessor);
  });

  afterAll(async () => {
    // Cleanup any test trace details we added
    await systemPrisma.agentTrace.deleteMany({
      where: { externalTraceId: { in: ['test-trace-123', 'test-trace-duplicate'] } },
    });
    await systemPrisma.rawTrace.deleteMany({
      where: { payload: { path: ['id'], equals: 'test-trace-123' } },
    });
    await systemPrisma.rawTrace.deleteMany({
      where: { payload: { path: ['id'], equals: 'test-trace-duplicate' } },
    });
    await app.close();
  });

  beforeEach(() => {
    mockQueue.add.mockClear();
  });

  it('1. POST /v1/traces should fail with 401 if API key is missing', async () => {
    const response = await app.getHttpAdapter().getInstance().inject({
      method: 'POST',
      url: '/v1/traces',
      payload: {},
    });

    expect(response.statusCode).toBe(401);
  });

  it('2. POST /v1/traces should fail with 400 if payload is invalid (Zod validation)', async () => {
    const response = await app.getHttpAdapter().getInstance().inject({
      method: 'POST',
      url: '/v1/traces',
      headers: {
        'x-api-key': 'sk_live_prod_12345678abcdef',
      },
      payload: {
        id: '', // Empty external trace ID should fail Zod
        name: 'Test Trace',
        spans: [],
      },
    });

    expect(response.statusCode).toBe(400);
    const body = JSON.parse(response.payload);
    expect(body.message).toBe('Telemetry payload validation failed');
    expect(body.errors).toBeDefined();
  });

  it('3. POST /v1/traces should succeed with 202, write PENDING RawTrace, and enqueue job', async () => {
    const payload = {
      id: 'test-trace-123',
      name: 'Agent Execution Loop',
      status: TraceStatus.SUCCESS,
      metadata: { environment: 'production' },
      spans: [
        {
          id: '550e8400-e29b-41d4-a716-446655440000', // Valid UUID
          type: SpanType.AGENT,
          name: 'Main Loop',
          status: TraceStatus.SUCCESS,
          startTime: '2026-06-17T12:00:00.000Z',
          endTime: '2026-06-17T12:00:05.000Z',
          metadata: { step: 1 },
        },
      ],
    };

    const response = await app.getHttpAdapter().getInstance().inject({
      method: 'POST',
      url: '/v1/traces',
      headers: {
        'x-api-key': 'sk_live_prod_12345678abcdef',
      },
      payload,
    });

    expect(response.statusCode).toBe(202);
    const body = JSON.parse(response.payload);
    expect(body.status).toBe('accepted');
    expect(body.rawTraceId).toBeDefined();

    // Verify raw trace record was created in PENDING status
    const rawTrace = await systemPrisma.rawTrace.findUnique({
      where: { id: body.rawTraceId },
    });
    expect(rawTrace).toBeDefined();
    expect(rawTrace?.status).toBe(TraceStatus.PENDING);
    expect(rawTrace?.payload).toEqual(payload);

    // Verify job was enqueued
    expect(mockQueue.add).toHaveBeenCalledTimes(1);
    expect(mockQueue.add).toHaveBeenCalledWith(
      'process-trace',
      expect.objectContaining({
        rawTraceId: rawTrace?.id,
        projectId: rawTrace?.projectId,
      }),
      expect.objectContaining({
        jobId: rawTrace?.id,
      })
    );
  });

  it('4. TraceProcessor should process the raw trace, construct nested spans and aggregate metrics', async () => {
    // Create a new RawTrace record directly via systemPrisma
    const project = await systemPrisma.project.findFirst({
      where: { apiKeys: { some: { prefix: 'sk_live_prod' } } },
    });
    expect(project).toBeDefined();

    const tracePayload = {
      id: 'test-trace-123',
      name: 'Nested Execution Flow',
      status: TraceStatus.SUCCESS,
      metadata: { test: true },
      spans: [
        {
          id: 'd9b736b0-16b7-4e96-af00-a6e5db8dcdbe',
          type: SpanType.AGENT,
          name: 'Agent Process',
          status: TraceStatus.SUCCESS,
          startTime: '2026-06-17T12:00:00.000Z',
          endTime: '2026-06-17T12:00:08.000Z',
        },
        {
          id: '50cb88c4-be00-4b53-83eb-62cf9b3f3a0a',
          parentSpanId: 'd9b736b0-16b7-4e96-af00-a6e5db8dcdbe',
          type: SpanType.CHAIN,
          name: 'Thought Chain',
          status: TraceStatus.SUCCESS,
          startTime: '2026-06-17T12:00:01.000Z',
          endTime: '2026-06-17T12:00:07.000Z',
        },
        {
          id: 'fb919782-b7e6-4273-aa49-74d306b6eb67',
          parentSpanId: '50cb88c4-be00-4b53-83eb-62cf9b3f3a0a',
          type: SpanType.LLM,
          name: 'OpenAI Prompt',
          status: TraceStatus.SUCCESS,
          startTime: '2026-06-17T12:00:02.000Z',
          endTime: '2026-06-17T12:00:05.000Z',
          tokenCount: { prompt: 100, completion: 50 },
          cost: 0.003,
        },
        {
          id: '6b6c8cd3-4e31-419b-b9f0-c65d6c8b9d31',
          parentSpanId: '50cb88c4-be00-4b53-83eb-62cf9b3f3a0a',
          type: SpanType.TOOL,
          name: 'Search Web Tool',
          status: TraceStatus.SUCCESS,
          startTime: '2026-06-17T12:00:05.500Z',
          endTime: '2026-06-17T12:00:06.800Z',
          cost: 0.0005,
        },
      ],
    };

    const rawTrace = await systemPrisma.rawTrace.create({
      data: {
        projectId: project!.id,
        payload: tracePayload as any,
        status: TraceStatus.PENDING,
      },
    });

    const mockJob = {
      id: 'mock-job-1',
      data: {
        rawTraceId: rawTrace.id,
        projectId: project!.id,
        tenantId: project!.tenantId,
      },
    } as any;

    // Run the processor directly
    await processor.process(mockJob);

    // Verify RawTrace has been updated to SUCCESS
    const updatedRawTrace = await systemPrisma.rawTrace.findUnique({
      where: { id: rawTrace.id },
    });
    expect(updatedRawTrace?.status).toBe(TraceStatus.SUCCESS);
    expect(updatedRawTrace?.error).toBeNull();

    // Verify AgentTrace aggregates
    const agentTrace = await systemPrisma.agentTrace.findUnique({
      where: {
        projectId_externalTraceId: {
          projectId: project!.id,
          externalTraceId: 'test-trace-123',
        },
      },
      include: { spans: true },
    });

    expect(agentTrace).toBeDefined();
    expect(agentTrace?.name).toBe('Nested Execution Flow');
    expect(agentTrace?.tokensUsed).toBe(150); // 100 + 50
    expect(Number(agentTrace?.cost)).toBeCloseTo(0.0035, 6); // 0.003 + 0.0005
    expect(agentTrace?.latencyMs).toBe(8000); // 12:00:08.000 - 12:00:00.000 = 8000ms

    // Verify span parent-child relationships and mapping
    expect(agentTrace?.spans.length).toBe(4);

    const rootSpan = agentTrace?.spans.find(s => s.name === 'Agent Process');
    const chainSpan = agentTrace?.spans.find(s => s.name === 'Thought Chain');
    const llmSpan = agentTrace?.spans.find(s => s.name === 'OpenAI Prompt');
    const toolSpan = agentTrace?.spans.find(s => s.name === 'Search Web Tool');

    expect(rootSpan?.parentSpanId).toBeNull();
    expect(chainSpan?.parentSpanId).toBe(rootSpan?.id);
    expect(llmSpan?.parentSpanId).toBe(chainSpan?.id);
    expect(toolSpan?.parentSpanId).toBe(chainSpan?.id);

    expect(llmSpan?.tokenCount).toEqual({ prompt: 100, completion: 50 });
    expect(Number(llmSpan?.cost)).toBe(0.003);
  });

  it('5. TraceProcessor should handle idempotency by replacing duplicate traces', async () => {
    const project = await systemPrisma.project.findFirst({
      where: { apiKeys: { some: { prefix: 'sk_live_prod' } } },
    });

    const initialPayload = {
      id: 'test-trace-duplicate',
      name: 'Initial Trace Run',
      status: TraceStatus.SUCCESS,
      spans: [
        {
          id: 'aa22bb33-cccc-4ddd-aeee-ffff00001111',
          type: SpanType.AGENT,
          name: 'First Version Span',
          startTime: '2026-06-17T12:00:00.000Z',
          endTime: '2026-06-17T12:00:01.000Z',
        },
      ],
    };

    // Process Initial Trace
    const rawTrace1 = await systemPrisma.rawTrace.create({
      data: {
        projectId: project!.id,
        payload: initialPayload as any,
        status: TraceStatus.PENDING,
      },
    });

    await processor.process({
      id: 'mock-job-2',
      data: { rawTraceId: rawTrace1.id, projectId: project!.id, tenantId: project!.tenantId },
    } as any);

    // Verify initial run exists
    let agentTrace = await systemPrisma.agentTrace.findUnique({
      where: { projectId_externalTraceId: { projectId: project!.id, externalTraceId: 'test-trace-duplicate' } },
      include: { spans: true },
    });
    expect(agentTrace?.name).toBe('Initial Trace Run');
    expect(agentTrace?.spans[0].name).toBe('First Version Span');

    // Create a modified payload with same ID (e.g. retry / update payload)
    const updatedPayload = {
      id: 'test-trace-duplicate',
      name: 'Updated Trace Run',
      status: TraceStatus.SUCCESS,
      spans: [
        {
          id: 'bb33cc44-dddd-4eee-aeee-000011112222',
          type: SpanType.AGENT,
          name: 'Second Version Span',
          startTime: '2026-06-17T12:00:00.000Z',
          endTime: '2026-06-17T12:00:02.000Z',
        },
      ],
    };

    const rawTrace2 = await systemPrisma.rawTrace.create({
      data: {
        projectId: project!.id,
        payload: updatedPayload as any,
        status: TraceStatus.PENDING,
      },
    });

    // Run processor again. It must cleanly delete the old trace and spans, and save new one without unique key collision
    await processor.process({
      id: 'mock-job-3',
      data: { rawTraceId: rawTrace2.id, projectId: project!.id, tenantId: project!.tenantId },
    } as any);

    agentTrace = await systemPrisma.agentTrace.findUnique({
      where: { projectId_externalTraceId: { projectId: project!.id, externalTraceId: 'test-trace-duplicate' } },
      include: { spans: true },
    });

    expect(agentTrace?.name).toBe('Updated Trace Run');
    expect(agentTrace?.spans.length).toBe(1);
    expect(agentTrace?.spans[0].name).toBe('Second Version Span');
  });
});
