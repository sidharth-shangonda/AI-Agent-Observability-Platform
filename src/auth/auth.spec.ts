import { Test, TestingModule } from '@nestjs/testing';
import { FastifyAdapter, NestFastifyApplication } from '@nestjs/platform-fastify';
import { AppModule } from '../app.module';

describe('Auth & RLS Integration Tests (Phase 2)', () => {
  let app: NestFastifyApplication;

  beforeAll(async () => {
    const moduleFixture: TestingModule = await Test.createTestingModule({
      imports: [AppModule],
    }).compile();

    app = moduleFixture.createNestApplication<NestFastifyApplication>(
      new FastifyAdapter()
    );

    await app.init();
    await app.getHttpAdapter().getInstance().ready();
  });

  afterAll(async () => {
    await app.close();
  });

  it('1. GET /health/protected should fail with 401 if API key is missing', async () => {
    const response = await app.getHttpAdapter().getInstance().inject({
      method: 'GET',
      url: '/health/protected',
    });

    expect(response.statusCode).toBe(401);
    const body = JSON.parse(response.payload);
    expect(body.message).toBe('API key is missing');
    expect(body.error).toBe('Unauthorized');
  });

  it('2. GET /health/protected should fail with 401 if API key is invalid', async () => {
    const response = await app.getHttpAdapter().getInstance().inject({
      method: 'GET',
      url: '/health/protected',
      headers: {
        'x-api-key': 'sk_live_invalidkey',
      },
    });

    expect(response.statusCode).toBe(401);
    const body = JSON.parse(response.payload);
    expect(body.message).toBe('Invalid or inactive API key');
    expect(body.error).toBe('Unauthorized');
  });

  it('3. GET /health/protected should succeed with 200 using valid Production API key (Bearer auth)', async () => {
    const response = await app.getHttpAdapter().getInstance().inject({
      method: 'GET',
      url: '/health/protected',
      headers: {
        authorization: 'Bearer sk_live_prod_12345678abcdef',
      },
    });

    expect(response.statusCode).toBe(200);
    const body = JSON.parse(response.payload);
    expect(body.status).toBe('authenticated');
    expect(body.context.tenantId).toBeDefined();
    expect(body.context.projectId).toBeDefined();
    
    // Production has 1 seeded trace.
    // Proves the query was isolated to Production project and counted 1 row.
    expect(body.data.traceCount).toBe(1);
  });

  it('4. GET /health/protected should succeed with 200 using valid Staging API key (x-api-key header)', async () => {
    const response = await app.getHttpAdapter().getInstance().inject({
      method: 'GET',
      url: '/health/protected',
      headers: {
        'x-api-key': 'sk_test_stage_87654321fedcba',
      },
    });

    expect(response.statusCode).toBe(200);
    const body = JSON.parse(response.payload);
    expect(body.status).toBe('authenticated');
    expect(body.context.tenantId).toBeDefined();
    expect(body.context.projectId).toBeDefined();
    
    // Staging has 0 seeded traces.
    // Proves that RLS isolated the query so that the Production trace was not visible.
    expect(body.data.traceCount).toBe(0);
  });
});
