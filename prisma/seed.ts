import { PrismaClient } from '@prisma/client';
import { PrismaPg } from '@prisma/adapter-pg';
import { Pool } from 'pg';
import * as crypto from 'crypto';

const pool = new Pool({ connectionString: process.env.DATABASE_URL });
const adapter = new PrismaPg(pool);
const prisma = new PrismaClient({ adapter });

function hashApiKey(key: string): string {
  return crypto.createHash('sha256').update(key).digest('hex');
}

async function setTenantContext(tenantId: string) {
  await prisma.$executeRawUnsafe(`SET app.current_tenant_id = '${tenantId}'`);
}

async function setProjectContext(projectId: string) {
  await prisma.$executeRawUnsafe(`SET app.current_project_id = '${projectId}'`);
}

async function main() {
  console.log('🌱 Starting database seeding...');

  // 1. Create Tenant (Demo Corporation)
  // Tenant is not project-scoped, but it has no parent table, so RLS policy allows insertions if context is matches (or we bypass by not having tenantId restriction on Tenant table itself)
  // Wait, does Tenant have RLS enabled? No, our migration enabled it for: Project, ApiKey, RawTrace, AgentTrace, AgentSpan, AgentMemory, EvaluationResult, WebhookEndpoint, WebhookOutbox. Tenant is a global system table, so it does not have RLS. We can insert directly.
  const tenant = await prisma.tenant.create({
    data: {
      name: 'Demo Corporation',
    },
  });
  console.log(`✅ Tenant created: ${tenant.name} (${tenant.id})`);

  // Set Tenant Context to allow inserting projects
  await setTenantContext(tenant.id);

  // 2. Create Projects (isolated workspaces)
  const prodProject = await prisma.project.create({
    data: {
      tenantId: tenant.id,
      name: 'Production AI Agent',
    },
  });
  const stagingProject = await prisma.project.create({
    data: {
      tenantId: tenant.id,
      name: 'Staging AI Agent',
    },
  });
  console.log(`✅ Projects created:\n - Prod: ${prodProject.name} (${prodProject.id})\n - Staging: ${stagingProject.name} (${stagingProject.id})`);

  // 3. Create API Keys (hashed for security)
  const prodPlainKey = 'sk_live_prod_12345678abcdef';
  const stagingPlainKey = 'sk_test_stage_87654321fedcba';

  // Set Project Context to insert API keys
  await setProjectContext(prodProject.id);
  const prodApiKey = await prisma.apiKey.create({
    data: {
      projectId: prodProject.id,
      name: 'Production SDK Key',
      prefix: 'sk_live_prod',
      hashedKey: hashApiKey(prodPlainKey),
      isActive: true,
    },
  });

  await setProjectContext(stagingProject.id);
  const stagingApiKey = await prisma.apiKey.create({
    data: {
      projectId: stagingProject.id,
      name: 'Staging SDK Key',
      prefix: 'sk_test_stage',
      hashedKey: hashApiKey(stagingPlainKey),
      isActive: true,
    },
  });

  console.log(`✅ API Keys seeded:`);
  console.log(` - Production Key: prefix: ${prodApiKey.prefix}, plain: ${prodPlainKey}`);
  console.log(` - Staging Key: prefix: ${stagingApiKey.prefix}, plain: ${stagingPlainKey}`);

  // 4. Seed a test Trace & Spans inside Production Project
  await setProjectContext(prodProject.id);
  const prodTrace = await prisma.agentTrace.create({
    data: {
      projectId: prodProject.id,
      name: 'Translate User Request',
      externalTraceId: 'trace-external-prod-001',
      status: 'SUCCESS',
      tokensUsed: 150,
      cost: 0.000300,
      latencyMs: 850,
    },
  });

  const parentSpan = await prisma.agentSpan.create({
    data: {
      traceId: prodTrace.id,
      name: 'Root Translation Agent',
      type: 'AGENT',
      status: 'SUCCESS',
      startTime: new Date(Date.now() - 850),
      endTime: new Date(),
      latencyMs: 850,
      input: { text: 'Hello, how are you?', target: 'es' },
      output: { response: 'Hola, ¿cómo estás?' },
    },
  });

  await prisma.agentSpan.create({
    data: {
      traceId: prodTrace.id,
      parentSpanId: parentSpan.id,
      name: 'gpt-4o-translation-call',
      type: 'LLM',
      status: 'SUCCESS',
      startTime: new Date(Date.now() - 800),
      endTime: new Date(Date.now() - 100),
      latencyMs: 700,
      input: { prompt: 'Translate "Hello, how are you?" to Spanish' },
      output: { response: 'Hola, ¿cómo estás?' },
      tokenCount: { prompt: 40, completion: 12 },
      cost: 0.000200,
    },
  });

  console.log(`✅ Seeded production trace: ${prodTrace.name} (${prodTrace.id})`);

  // 5. Seed a test Vector Memory block inside Production Project
  // We use raw SQL because pgvector is mapped to Unsupported("vector(1536)")
  const mockVector = Array(1536).fill(0.015); // dummy vector array
  mockVector[0] = 0.5; // give it a distinct weight
  const vectorString = `[${mockVector.join(',')}]`;

  await prisma.$executeRawUnsafe(`
    INSERT INTO "AgentMemory" ("id", "projectId", "content", "embedding", "metadata", "createdAt")
    VALUES (
      '${crypto.randomUUID()}',
      '${prodProject.id}',
      'The user prefers polite greetings and Spanish translations.',
      '${vectorString}'::vector,
      '{"source": "seeding"}'::jsonb,
      NOW()
    );
  `);

  console.log('✅ Seeded Agent Memory with 1536-dimensional pgvector embedding.');

  console.log('🌱 Seeding complete successfully!');
}

main()
  .catch((e) => {
    console.error('❌ Seeding failed:', e);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
    await pool.end();
  });
