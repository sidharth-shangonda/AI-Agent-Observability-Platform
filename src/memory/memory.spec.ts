import { Test, TestingModule } from '@nestjs/testing';
import { FastifyAdapter, NestFastifyApplication } from '@nestjs/platform-fastify';
import { AppModule } from '../app.module';
import { SystemPrismaService } from '../prisma/system-prisma.service';

function generateMockVector(offset: number): number[] {
  const vec = [];
  for (let i = 0; i < 1536; i++) {
    vec.push(Math.sin(i + offset));
  }
  return vec;
}

describe('Memory & Vector Search Integration Tests (Phase 5)', () => {
  let app: NestFastifyApplication;
  let systemPrisma: SystemPrismaService;

  beforeAll(async () => {
    const moduleFixture: TestingModule = await Test.createTestingModule({
      imports: [AppModule],
    }).compile();

    app = moduleFixture.createNestApplication<NestFastifyApplication>(new FastifyAdapter());
    await app.init();
    await app.getHttpAdapter().getInstance().ready();

    systemPrisma = app.get(SystemPrismaService);
  });

  afterAll(async () => {
    // Cleanup any test memories we added
    await systemPrisma.agentMemory.deleteMany({
      where: {
        content: { startsWith: 'test-memory-' },
      },
    });
    await app.close();
  });

  it('1. POST /v1/memory should fail with 401 if API key is missing', async () => {
    const response = await app.getHttpAdapter().getInstance().inject({
      method: 'POST',
      url: '/v1/memory',
      payload: {},
    });

    expect(response.statusCode).toBe(401);
  });

  it('2. POST /v1/memory should fail with 400 if embedding is not 1536 dimensions', async () => {
    const response = await app.getHttpAdapter().getInstance().inject({
      method: 'POST',
      url: '/v1/memory',
      headers: {
        'x-api-key': 'sk_live_prod_12345678abcdef',
      },
      payload: {
        content: 'test-memory-invalid-dim',
        embedding: [0.1, 0.2, 0.3], // Invalid dimensions
      },
    });

    expect(response.statusCode).toBe(400);
    const body = JSON.parse(response.payload);
    expect(body.message).toBe('Memory store validation failed');
  });

  it('3. POST /v1/memory should successfully store memory under active project context', async () => {
    const response = await app.getHttpAdapter().getInstance().inject({
      method: 'POST',
      url: '/v1/memory',
      headers: {
        'x-api-key': 'sk_live_prod_12345678abcdef',
      },
      payload: {
        content: 'test-memory-valid-1',
        embedding: generateMockVector(0.0),
        metadata: { source: 'unit-test', traceId: 'trace-test-555' },
      },
    });

    expect(response.statusCode).toBe(201);
    const body = JSON.parse(response.payload);
    expect(body.id).toBeDefined();
    expect(body.content).toBe('test-memory-valid-1');

    // Verify stored in DB
    const dbRecord = await systemPrisma.agentMemory.findUnique({
      where: { id: body.id },
    });
    expect(dbRecord).toBeDefined();
    expect(dbRecord?.content).toBe('test-memory-valid-1');
  });

  it('4. POST /v1/memory/search should retrieve similar memories ordered by similarity', async () => {
    // Insert 3 memories with different offsets
    // 1. Identical offset (0.1)
    // 2. Medium offset (0.5)
    // 3. Opposite offset (Math.PI)
    await app.getHttpAdapter().getInstance().inject({
      method: 'POST',
      url: '/v1/memory',
      headers: { 'x-api-key': 'sk_live_prod_12345678abcdef' },
      payload: {
        content: 'test-memory-search-high',
        embedding: generateMockVector(0.1),
      },
    });
    await app.getHttpAdapter().getInstance().inject({
      method: 'POST',
      url: '/v1/memory',
      headers: { 'x-api-key': 'sk_live_prod_12345678abcdef' },
      payload: {
        content: 'test-memory-search-mid',
        embedding: generateMockVector(0.5),
      },
    });
    await app.getHttpAdapter().getInstance().inject({
      method: 'POST',
      url: '/v1/memory',
      headers: { 'x-api-key': 'sk_live_prod_12345678abcdef' },
      payload: {
        content: 'test-memory-search-low',
        embedding: generateMockVector(Math.PI),
      },
    });

    // Execute similarity search with query vector at offset 0.1
    const searchResponse = await app.getHttpAdapter().getInstance().inject({
      method: 'POST',
      url: '/v1/memory/search',
      headers: { 'x-api-key': 'sk_live_prod_12345678abcdef' },
      payload: {
        embedding: generateMockVector(0.1),
        limit: 5,
        minSimilarity: -1.0,
      },
    });

    expect(searchResponse.statusCode).toBe(200);
    const results = JSON.parse(searchResponse.payload);
    
    // Should have retrieved all 3 (and potentially test-memory-valid-1 which is offset 0.0)
    expect(results.length).toBeGreaterThanOrEqual(3);

    // Verify ordering by similarity descending
    const firstResult = results[0];
    const secondResult = results[1];

    expect(firstResult.content).toBe('test-memory-search-high'); // Exact match to query (offset 0.1)
    expect(firstResult.similarity).toBeCloseTo(1.0, 5);

    expect(['test-memory-valid-1', 'test-memory-search-mid']).toContain(secondResult.content);
    expect(firstResult.similarity).toBeGreaterThan(secondResult.similarity);
  });

  it('5. POST /v1/memory/search should filter results by minSimilarity', async () => {
    // Search with high similarity threshold
    const searchResponse = await app.getHttpAdapter().getInstance().inject({
      method: 'POST',
      url: '/v1/memory/search',
      headers: { 'x-api-key': 'sk_live_prod_12345678abcdef' },
      payload: {
        embedding: generateMockVector(0.1),
        limit: 5,
        minSimilarity: 0.9, // high threshold, should exclude 'test-memory-search-low' (opposite)
      },
    });

    expect(searchResponse.statusCode).toBe(200);
    const results = JSON.parse(searchResponse.payload);

    // Low similarity match should NOT be in the results
    const lowMatch = results.find((r: any) => r.content === 'test-memory-search-low');
    expect(lowMatch).toBeUndefined();
  });

  it('6. RLS project isolation: Staging project should not see Production memories', async () => {
    // Query search using staging project API key
    const searchResponse = await app.getHttpAdapter().getInstance().inject({
      method: 'POST',
      url: '/v1/memory/search',
      headers: { 'x-api-key': 'sk_test_stage_87654321fedcba' },
      payload: {
        embedding: generateMockVector(0.1),
        limit: 5,
        minSimilarity: -1.0,
      },
    });

    expect(searchResponse.statusCode).toBe(200);
    const results = JSON.parse(searchResponse.payload);

    // Staging project has no memories stored. It must return 0 results.
    // It should NOT see any of the production test memories we stored.
    expect(results.length).toBe(0);
  });

  it('7. GET /v1/memory/trace/:traceId should filter memories by trace reference in metadata', async () => {
    const traceId = 'trace-test-555';
    const response = await app.getHttpAdapter().getInstance().inject({
      method: 'GET',
      url: `/v1/memory/trace/${traceId}`,
      headers: { 'x-api-key': 'sk_live_prod_12345678abcdef' },
    });

    expect(response.statusCode).toBe(200);
    const results = JSON.parse(response.payload);
    expect(results.length).toBe(1);
    expect(results[0].content).toBe('test-memory-valid-1');
  });

  it('8. DELETE /v1/memory/:id should delete memory successfully', async () => {
    // Store a memory to delete
    const storeResponse = await app.getHttpAdapter().getInstance().inject({
      method: 'POST',
      url: '/v1/memory',
      headers: { 'x-api-key': 'sk_live_prod_12345678abcdef' },
      payload: {
        content: 'test-memory-to-delete',
        embedding: generateMockVector(0.0),
      },
    });

    const body = JSON.parse(storeResponse.payload);
    const deleteId = body.id;

    // Delete it
    const deleteResponse = await app.getHttpAdapter().getInstance().inject({
      method: 'DELETE',
      url: `/v1/memory/${deleteId}`,
      headers: { 'x-api-key': 'sk_live_prod_12345678abcdef' },
    });
    expect(deleteResponse.statusCode).toBe(204);

    // Verify it is gone from DB
    const dbRecord = await systemPrisma.agentMemory.findUnique({
      where: { id: deleteId },
    });
    expect(dbRecord).toBeNull();
  });
});
