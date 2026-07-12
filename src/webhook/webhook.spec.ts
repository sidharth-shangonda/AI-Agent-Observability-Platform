import { Test, TestingModule } from '@nestjs/testing';
import { FastifyAdapter, NestFastifyApplication } from '@nestjs/platform-fastify';
import { AppModule } from '../app.module';
import { getQueueToken } from '@nestjs/bullmq';
import { SystemPrismaService } from '../prisma/system-prisma.service';
import { TraceProcessor } from '../telemetry/trace.processor';
import { WebhookProcessor } from './webhook.processor';
import { Severity } from '@prisma/client';
import * as http from 'http';
import * as crypto from 'crypto';

describe('Webhook Alerting & Anomaly Engine Integration Tests (Phase 6)', () => {
  let app: NestFastifyApplication;
  let systemPrisma: SystemPrismaService;
  let traceProcessor: TraceProcessor;
  let webhookProcessor: WebhookProcessor;
  let registeredEndpoint: any;

  // Mock server to catch outgoing webhooks
  let mockServer: http.Server;
  let lastReceivedPayload: any = null;
  let lastReceivedHeaders: any = null;
  const mockServerPort = 9876;
  const webhookUrl = `http://127.0.0.1:${mockServerPort}/webhook-receiver`;
  const webhookSecret = 'super_secret_webhook_signing_key_123';

  // Mock BullMQ queues
  const mockTraceQueue = {
    add: jest.fn().mockResolvedValue({ id: 'mock-trace-job-id' }),
    opts: {
      connection: {
        host: process.env.REDIS_HOST || 'localhost',
        port: Number(process.env.REDIS_PORT) || 6379,
      },
    },
  };
  const mockWebhookQueue = {
    add: jest.fn().mockResolvedValue({ id: 'mock-webhook-job-id' }),
    opts: {
      connection: {
        host: process.env.REDIS_HOST || 'localhost',
        port: Number(process.env.REDIS_PORT) || 6379,
      },
    },
  };

  beforeAll(async () => {
    // 1. Spin up the mock webhook receiver server
    mockServer = http.createServer((req, res) => {
      let body = '';
      req.on('data', (chunk) => (body += chunk));
      req.on('end', () => {
        try {
          lastReceivedPayload = JSON.parse(body);
        } catch (e) {
          lastReceivedPayload = body;
        }
        lastReceivedHeaders = req.headers;
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ status: 'ok' }));
      });
    });

    await new Promise<void>((resolve) => {
      mockServer.listen(mockServerPort, resolve);
    });

    // 2. Bootstrap NestJS test module with overridden BullMQ queues
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
    webhookProcessor = app.get(WebhookProcessor);
  });

  afterAll(async () => {
    // Shutdown the mock HTTP server
    await new Promise<void>((resolve) => {
      mockServer.close(() => resolve());
    });

    // Delete ONLY the specific test data we created to avoid clearing seeds needed by other tests
    if (registeredEndpoint?.id) {
      await systemPrisma.webhookOutbox.deleteMany({
        where: { endpointId: registeredEndpoint.id },
      });
      await systemPrisma.webhookEndpoint.deleteMany({
        where: { id: registeredEndpoint.id },
      });
    }

    await systemPrisma.evaluationResult.deleteMany({
      where: { spanId: { in: ['4a2e5842-7a0e-4122-83b6-2ff929115b81', '901f4c71-b0ad-44b2-a4f6-8c9038234851', '618efb3b-e01a-4d22-86ff-90a8c2ef4852'] } },
    });

    await systemPrisma.agentSpan.deleteMany({
      where: { id: { in: ['4a2e5842-7a0e-4122-83b6-2ff929115b81', '901f4c71-b0ad-44b2-a4f6-8c9038234851', '618efb3b-e01a-4d22-86ff-90a8c2ef4852'] } },
    });

    await systemPrisma.agentTrace.deleteMany({
      where: { externalTraceId: 'trace-anomaly-ext-101' },
    });

    await systemPrisma.rawTrace.deleteMany({
      where: { id: 'trace-anomaly-test-raw-uuid' },
    });

    await app.close();
  });

  beforeEach(() => {
    jest.clearAllMocks();
    lastReceivedPayload = null;
    lastReceivedHeaders = null;
  });

  describe('1. Webhook Endpoint CRUD REST Endpoints (RLS Enforced)', () => {
    let createdWebhookId: string;

    it('POST /v1/webhooks should successfully register a new webhook configuration', async () => {
      const response = await app.getHttpAdapter().getInstance().inject({
        method: 'POST',
        url: '/v1/webhooks',
        headers: {
          authorization: 'Bearer sk_live_prod_12345678abcdef',
        },
        payload: {
          url: webhookUrl,
          secret: webhookSecret,
          events: ['anomaly.detected'],
        },
      });

      expect(response.statusCode).toBe(201);
      const body = JSON.parse(response.payload);
      expect(body.id).toBeDefined();
      expect(body.url).toBe(webhookUrl);
      expect(body.secret).toBe(webhookSecret);
      expect(body.isActive).toBe(true);

      createdWebhookId = body.id;
    });

    it('GET /v1/webhooks should list registered webhooks for the active project', async () => {
      const response = await app.getHttpAdapter().getInstance().inject({
        method: 'GET',
        url: '/v1/webhooks',
        headers: {
          authorization: 'Bearer sk_live_prod_12345678abcdef',
        },
      });

      expect(response.statusCode).toBe(200);
      const body = JSON.parse(response.payload);
      expect(Array.isArray(body)).toBe(true);
      expect(body.length).toBeGreaterThanOrEqual(1);
      expect(body.some((wh: any) => wh.id === createdWebhookId)).toBe(true);
    });

    it('GET /v1/webhooks should isolate scopes and NOT return Prod webhooks when querying with Staging API key', async () => {
      const response = await app.getHttpAdapter().getInstance().inject({
        method: 'GET',
        url: '/v1/webhooks',
        headers: {
          'x-api-key': 'sk_test_stage_87654321fedcba',
        },
      });

      expect(response.statusCode).toBe(200);
      const body = JSON.parse(response.payload);
      // Because Staging RLS context limits view scope, the Prod webhook endpoint is not visible here
      expect(body.some((wh: any) => wh.id === createdWebhookId)).toBe(false);
    });

    it('DELETE /v1/webhooks/:id should remove the endpoint config safely', async () => {
      // Deleting using the matching project key
      const response = await app.getHttpAdapter().getInstance().inject({
        method: 'DELETE',
        url: `/v1/webhooks/${createdWebhookId}`,
        headers: {
          authorization: 'Bearer sk_live_prod_12345678abcdef',
        },
      });

      expect(response.statusCode).toBe(204);

      // Verify deletion in DB
      const search = await systemPrisma.webhookEndpoint.findUnique({
        where: { id: createdWebhookId },
      });
      expect(search).toBeNull();
    });
  });

  describe('2. Anomaly Engine & Outbox Ingestion Flow', () => {
    let project: any;

    beforeAll(async () => {
      // Find the Production project
      project = await systemPrisma.project.findFirst({
        where: { name: 'Production AI Agent' },
      });

      // Insert an active webhook config directly for Production project
      registeredEndpoint = await systemPrisma.webhookEndpoint.create({
        data: {
          projectId: project.id,
          url: webhookUrl,
          secret: webhookSecret,
          events: ['anomaly.detected'],
        },
      });
    });

    it('Ingesting traces with anomaly features should trigger alerts and enqueue dispatch jobs', async () => {
      // Create a raw trace containing spans designed to trigger all three anomaly rules:
      // - Model status error (CRITICAL)
      // - Latency > 5000ms (MEDIUM)
      // - LLM cost > $0.010 (HIGH)
      const rawTraceId = 'trace-anomaly-test-raw-uuid';
      const rawTrace = await systemPrisma.rawTrace.create({
        data: {
          id: rawTraceId,
          projectId: project.id,
          status: 'PENDING',
          payload: {
            id: 'trace-anomaly-ext-101',
            name: 'Anomaly Test Trace',
            status: 'SUCCESS',
            spans: [
              {
                id: '4a2e5842-7a0e-4122-83b6-2ff929115b81',
                type: 'LLM',
                name: 'gpt-4o Call (Failing)',
                status: 'ERROR',
                startTime: '2026-07-12T12:00:00.000Z',
                endTime: '2026-07-12T12:00:01.000Z',
              },
              {
                id: '901f4c71-b0ad-44b2-a4f6-8c9038234851',
                type: 'CHAIN',
                name: 'Slow Database Query',
                status: 'SUCCESS',
                startTime: '2026-07-12T12:00:00.000Z',
                endTime: '2026-07-12T12:00:06.000Z', // 6 seconds latency
              },
              {
                id: '618efb3b-e01a-4d22-86ff-90a8c2ef4852',
                type: 'LLM',
                name: 'Large Claude prompt call',
                status: 'SUCCESS',
                startTime: '2026-07-12T12:00:00.000Z',
                endTime: '2026-07-12T12:00:01.000Z',
                cost: 0.015, // Costs $0.015, exceeding $0.010 threshold
              },
            ],
          },
        },
      });

      // Execute trace processor synchronously
      const mockJob = {
        id: 'mock-trace-ingestion-job',
        data: {
          rawTraceId: rawTrace.id,
          projectId: project.id,
          tenantId: project.tenantId,
        },
      } as any;

      await traceProcessor.process(mockJob);

      // Assertions:
      // 1. Trace successfully processed in database
      const dbTrace = await systemPrisma.agentTrace.findFirst({
        where: { externalTraceId: 'trace-anomaly-ext-101' },
        include: { spans: true },
      });
      expect(dbTrace).toBeDefined();
      expect(dbTrace?.spans.length).toBe(3);

      // 2. Assert Evaluation Results (Anomalies) are recorded
      const evaluations = await systemPrisma.evaluationResult.findMany({
        where: { spanId: { in: ['4a2e5842-7a0e-4122-83b6-2ff929115b81', '901f4c71-b0ad-44b2-a4f6-8c9038234851', '618efb3b-e01a-4d22-86ff-90a8c2ef4852'] } },
      });
      expect(evaluations.length).toBe(3);

      const errorEval = evaluations.find((e) => e.spanId === '4a2e5842-7a0e-4122-83b6-2ff929115b81');
      expect(errorEval?.detectorName).toBe('model_error');
      expect(errorEval?.severity).toBe(Severity.CRITICAL);

      const latencyEval = evaluations.find((e) => e.spanId === '901f4c71-b0ad-44b2-a4f6-8c9038234851');
      expect(latencyEval?.detectorName).toBe('latency_spike');
      expect(latencyEval?.severity).toBe(Severity.MEDIUM);

      const costEval = evaluations.find((e) => e.spanId === '618efb3b-e01a-4d22-86ff-90a8c2ef4852');
      expect(costEval?.detectorName).toBe('token_cost_spike');
      expect(costEval?.severity).toBe(Severity.HIGH);

      // 3. Assert WebhookOutbox entries are created (PENDING state)
      const outboxEntries = await systemPrisma.webhookOutbox.findMany({
        where: { endpointId: registeredEndpoint.id },
      });
      expect(outboxEntries.length).toBe(3);
      expect(outboxEntries.every((entry) => entry.status === 'PENDING')).toBe(true);

      // 4. Assert BullMQ dispatcher enqueued webhook delivery jobs
      expect(mockWebhookQueue.add).toHaveBeenCalledTimes(3);
    });
  });

  describe('3. Webhook Delivery Queue Worker & Cryptographic Signing', () => {
    let outboxEntry: any;

    beforeAll(async () => {
      // Find a pending outbox entry to process
      outboxEntry = await systemPrisma.webhookOutbox.findFirst({
        where: { status: 'PENDING' },
      });
    });

    it('Processing webhook outbox job should send signed HTTP POST request and mark status SENT', async () => {
      expect(outboxEntry).toBeDefined();

      const mockJob = {
        id: 'mock-webhook-delivery-job',
        data: {
          outboxId: outboxEntry.id,
        },
      } as any;

      // Trigger Webhook Processor manually
      await webhookProcessor.process(mockJob);

      // Assertions:
      // 1. Outbox entry status updated to SENT in DB
      const updatedOutbox = await systemPrisma.webhookOutbox.findUnique({
        where: { id: outboxEntry.id },
      });
      expect(updatedOutbox?.status).toBe('SENT');
      expect(updatedOutbox?.attempts).toBe(1);
      expect(updatedOutbox?.error).toBeNull();

      // 2. Mock Server received the HTTP request successfully
      expect(lastReceivedPayload).toBeDefined();
      expect(lastReceivedPayload.event).toBe('anomaly.detected');
      expect(lastReceivedPayload.anomaly).toBeDefined();

      // 3. Cryptographic Signature is valid (HMAC-SHA256)
      expect(lastReceivedHeaders).toBeDefined();
      const signatureHeader = lastReceivedHeaders['x-webhook-signature'];
      expect(signatureHeader).toBeDefined();

      const calculatedSignature = crypto
        .createHmac('sha256', webhookSecret)
        .update(JSON.stringify(lastReceivedPayload))
        .digest('hex');

      expect(signatureHeader).toBe(calculatedSignature);
    });
  });
});
