-- CreateExtension
CREATE EXTENSION IF NOT EXISTS "vector";

-- CreateEnum
CREATE TYPE "TraceStatus" AS ENUM ('PENDING', 'SUCCESS', 'ERROR');

-- CreateEnum
CREATE TYPE "SpanType" AS ENUM ('LLM', 'TOOL', 'RETRIEVER', 'CHAIN', 'AGENT');

-- CreateEnum
CREATE TYPE "Severity" AS ENUM ('LOW', 'MEDIUM', 'HIGH', 'CRITICAL');

-- CreateEnum
CREATE TYPE "DeliveryStatus" AS ENUM ('PENDING', 'SENT', 'FAILED');

-- CreateTable
CREATE TABLE "Tenant" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Tenant_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Project" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Project_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ApiKey" (
    "id" TEXT NOT NULL,
    "projectId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "hashedKey" TEXT NOT NULL,
    "prefix" TEXT NOT NULL,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ApiKey_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "RawTrace" (
    "id" TEXT NOT NULL,
    "projectId" TEXT NOT NULL,
    "payload" JSONB NOT NULL,
    "status" "TraceStatus" NOT NULL DEFAULT 'PENDING',
    "error" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "RawTrace_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "AgentTrace" (
    "id" TEXT NOT NULL,
    "projectId" TEXT NOT NULL,
    "externalTraceId" TEXT,
    "name" TEXT NOT NULL,
    "status" "TraceStatus" NOT NULL DEFAULT 'SUCCESS',
    "tokensUsed" INTEGER NOT NULL DEFAULT 0,
    "cost" DECIMAL(10,6) NOT NULL DEFAULT 0.0,
    "latencyMs" INTEGER NOT NULL DEFAULT 0,
    "metadata" JSONB,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "AgentTrace_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "AgentSpan" (
    "id" TEXT NOT NULL,
    "traceId" TEXT NOT NULL,
    "parentSpanId" TEXT,
    "type" "SpanType" NOT NULL,
    "name" TEXT NOT NULL,
    "status" "TraceStatus" NOT NULL DEFAULT 'SUCCESS',
    "startTime" TIMESTAMP(3) NOT NULL,
    "endTime" TIMESTAMP(3) NOT NULL,
    "latencyMs" INTEGER NOT NULL,
    "input" JSONB,
    "output" JSONB,
    "tokenCount" JSONB,
    "cost" DECIMAL(10,6) NOT NULL DEFAULT 0.0,
    "metadata" JSONB,

    CONSTRAINT "AgentSpan_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "AgentMemory" (
    "id" TEXT NOT NULL,
    "projectId" TEXT NOT NULL,
    "content" TEXT NOT NULL,
    "embedding" vector(1536) NOT NULL,
    "metadata" JSONB,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "AgentMemory_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "EvaluationResult" (
    "id" TEXT NOT NULL,
    "spanId" TEXT NOT NULL,
    "detectorName" TEXT NOT NULL,
    "severity" "Severity" NOT NULL,
    "reason" TEXT NOT NULL,
    "metadata" JSONB,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "EvaluationResult_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "WebhookEndpoint" (
    "id" TEXT NOT NULL,
    "projectId" TEXT NOT NULL,
    "url" TEXT NOT NULL,
    "secret" TEXT NOT NULL,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "events" JSONB NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "WebhookEndpoint_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "WebhookOutbox" (
    "id" TEXT NOT NULL,
    "endpointId" TEXT NOT NULL,
    "eventType" TEXT NOT NULL,
    "payload" JSONB NOT NULL,
    "status" "DeliveryStatus" NOT NULL DEFAULT 'PENDING',
    "attempts" INTEGER NOT NULL DEFAULT 0,
    "nextRetryAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "error" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "WebhookOutbox_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "DeadLetterJob" (
    "id" TEXT NOT NULL,
    "queueName" TEXT NOT NULL,
    "jobId" TEXT NOT NULL,
    "payload" JSONB NOT NULL,
    "error" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "DeadLetterJob_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "ApiKey_hashedKey_key" ON "ApiKey"("hashedKey");

-- CreateIndex
CREATE UNIQUE INDEX "AgentTrace_projectId_externalTraceId_key" ON "AgentTrace"("projectId", "externalTraceId");

-- AddForeignKey
ALTER TABLE "Project" ADD CONSTRAINT "Project_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "Tenant"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ApiKey" ADD CONSTRAINT "ApiKey_projectId_fkey" FOREIGN KEY ("projectId") REFERENCES "Project"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "RawTrace" ADD CONSTRAINT "RawTrace_projectId_fkey" FOREIGN KEY ("projectId") REFERENCES "Project"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AgentTrace" ADD CONSTRAINT "AgentTrace_projectId_fkey" FOREIGN KEY ("projectId") REFERENCES "Project"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AgentSpan" ADD CONSTRAINT "AgentSpan_traceId_fkey" FOREIGN KEY ("traceId") REFERENCES "AgentTrace"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AgentSpan" ADD CONSTRAINT "AgentSpan_parentSpanId_fkey" FOREIGN KEY ("parentSpanId") REFERENCES "AgentSpan"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AgentMemory" ADD CONSTRAINT "AgentMemory_projectId_fkey" FOREIGN KEY ("projectId") REFERENCES "Project"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "EvaluationResult" ADD CONSTRAINT "EvaluationResult_spanId_fkey" FOREIGN KEY ("spanId") REFERENCES "AgentSpan"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "WebhookEndpoint" ADD CONSTRAINT "WebhookEndpoint_projectId_fkey" FOREIGN KEY ("projectId") REFERENCES "Project"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "WebhookOutbox" ADD CONSTRAINT "WebhookOutbox_endpointId_fkey" FOREIGN KEY ("endpointId") REFERENCES "WebhookEndpoint"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- Create HNSW vector index for cosine distance similarity search on AgentMemory (1536 OpenAI dimension)
CREATE INDEX IF NOT EXISTS "AgentMemory_embedding_hnsw_idx" ON "AgentMemory" USING hnsw ("embedding" vector_cosine_ops);

-- Enable Row Level Security (RLS) on multi-tenant tables
ALTER TABLE "Project" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "ApiKey" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "RawTrace" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "AgentTrace" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "AgentSpan" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "AgentMemory" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "EvaluationResult" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "WebhookEndpoint" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "WebhookOutbox" ENABLE ROW LEVEL SECURITY;

-- Force RLS even for table owners / superuser
ALTER TABLE "Project" FORCE ROW LEVEL SECURITY;
ALTER TABLE "ApiKey" FORCE ROW LEVEL SECURITY;
ALTER TABLE "RawTrace" FORCE ROW LEVEL SECURITY;
ALTER TABLE "AgentTrace" FORCE ROW LEVEL SECURITY;
ALTER TABLE "AgentSpan" FORCE ROW LEVEL SECURITY;
ALTER TABLE "AgentMemory" FORCE ROW LEVEL SECURITY;
ALTER TABLE "EvaluationResult" FORCE ROW LEVEL SECURITY;
ALTER TABLE "WebhookEndpoint" FORCE ROW LEVEL SECURITY;
ALTER TABLE "WebhookOutbox" FORCE ROW LEVEL SECURITY;

-- Create Tenant Isolation Policies (session: app.current_tenant_id)
CREATE POLICY project_tenant_isolation ON "Project"
  USING ("tenantId" = current_setting('app.current_tenant_id', true));

-- Create Project Isolation Policies (session: app.current_project_id)
CREATE POLICY key_project_isolation ON "ApiKey"
  USING ("projectId" = current_setting('app.current_project_id', true));

CREATE POLICY raw_trace_project_isolation ON "RawTrace"
  USING ("projectId" = current_setting('app.current_project_id', true));

CREATE POLICY agent_trace_project_isolation ON "AgentTrace"
  USING ("projectId" = current_setting('app.current_project_id', true));

CREATE POLICY agent_memory_project_isolation ON "AgentMemory"
  USING ("projectId" = current_setting('app.current_project_id', true));

CREATE POLICY webhook_endpoint_project_isolation ON "WebhookEndpoint"
  USING ("projectId" = current_setting('app.current_project_id', true));

-- Nested table isolation policies based on parent tables
CREATE POLICY span_project_isolation ON "AgentSpan"
  USING ("traceId" IN (
    SELECT "id" FROM "AgentTrace" WHERE "projectId" = current_setting('app.current_project_id', true)
  ));

CREATE POLICY evaluation_project_isolation ON "EvaluationResult"
  USING ("spanId" IN (
    SELECT "id" FROM "AgentSpan" WHERE "traceId" IN (
      SELECT "id" FROM "AgentTrace" WHERE "projectId" = current_setting('app.current_project_id', true)
    )
  ));

CREATE POLICY webhook_outbox_project_isolation ON "WebhookOutbox"
  USING ("endpointId" IN (
    SELECT "id" FROM "WebhookEndpoint" WHERE "projectId" = current_setting('app.current_project_id', true)
  ));

