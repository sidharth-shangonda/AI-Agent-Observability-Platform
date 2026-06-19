# AI Agent Observability Platform

A production-grade, high-throughput, multi-tenant backend platform designed to ingest, trace, and monitor AI agent executions in real-time. It helps developers debug nested LLM chains, analyze tool executions, track token costs, detect anomalies, and search agent memory.

Think of it as a developer-first, self-hosted alternative to platforms like **Langfuse**, **Helicone**, and **AgentOps**.

---

## The Problem

AI agents are notoriously difficult to debug in production because a single user request triggers a cascade of hidden, nested steps:
1. **Retrieval**: Querying vector databases for context.
2. **LLM Calls**: Multiple reasoning and planning steps.
3. **Tool Executions**: Searching web APIs, running calculations, or reading databases.
4. **Memory Loops**: Saving and retrieving agent state.

When an agent behaves abnormally (e.g., hallucinating, failing a tool call, or entering an infinite loop), developers need answers to:
* *Which specific step failed?*
* *Was the latency spike caused by the model, database, or a third-party API?*
* *How many tokens were consumed, and what did this run cost?*
* *Was the retrieved memory relevant?*
* *Which tenant/project was affected?*

This platform provides deep visibility into these execution graphs.

---

## Tech Stack

* **Language & Framework**: TypeScript, NestJS (Fastify Adapter for high-performance throughput)
* **Database & ORM**: PostgreSQL 16, Prisma ORM, `pgvector` extension
* **Caching & Message Queue**: Redis 7, BullMQ (for asynchronous background trace workers)
* **Observability & Health**: Prometheus, Grafana, Jest (Integration testing)
* **Infrastructure**: Docker, Docker Compose, GitHub Actions

---

## System Architecture

```mermaid
graph TD
    Client[Client AI Application] -->|1. POST /v1/traces| API[NestJS Fastify API]
    API -->|2. Validate & Hashed Auth| Guard[ApiKeyGuard]
    Guard -->|3. Establish Context| ALS[AsyncLocalStorage Context]
    API -->|4. Push Raw Trace| Queue[(Redis / BullMQ)]
    API -->|5. Return 202 Accepted| Client
    
    Queue -->|6. Process Asynchronously| Worker[Background Worker]
    Worker -->|7. Parse Spans & Hierarchy| Prisma[Prisma Service]
    Prisma -->|8. Apply RLS session variable| DB[(PostgreSQL + pgvector)]
    
    Worker -->|9. Check Anomaly Rules| Engine[Anomaly Engine]
    Engine -->|10. Alert| Webhook[Webhook Outbox Queue]
    
    Prometheus[Prometheus Metrics] -->|Scrape /metrics| API
    Grafana[Grafana Dashboard] -->|Visualize Metrics| Prometheus
```

---

## Project Roadmap & Status

Below is the structured progress of the **60-day engineering roadmap**:

### 🟩 Phase 0 — Foundation (Days 1–3)
* **NestJS Fastify Adapter**: Replaced default Express with Fastify to maximize API throughput for trace ingestion.
* **Strict Runtime Config Validation**: Implemented Zod environment parsing at boot, failing fast if required parameters are missing.
* **Local Developer Container Stack**: Configured a `docker-compose.yml` running PostgreSQL 16 (pgvector), Redis 7, and Prometheus.
* **Health Check Endpoint**: Exposed `GET /health` returning timestamped status metrics.

### 🟩 Phase 1 — Database & Multi-Tenancy (Days 4–10)
* **Prisma v7 Configuration**: Implemented Prisma's decoupled configuration using `prisma.config.ts` to manage environment connections.
* **Schema Design**: Implemented 11 models: `Tenant`, `Project`, `ApiKey`, `RawTrace`, `AgentTrace`, `AgentSpan`, `AgentMemory`, `EvaluationResult`, `WebhookEndpoint`, `WebhookOutbox`, and `DeadLetterJob`.
* **pgvector Extension & Cosine Index**: Configured the `vector` extension and built a manual SQL migration to compile an **HNSW index** on `AgentMemory` embeddings.
* **Tenant Isolation (Row-Level Security)**: Enabled and forced RLS on all tables. Created a dedicated non-superuser database role (`observability_app`) to run application queries, ensuring no database access is permitted without a valid tenant context.
* **Database Seeding**: Implemented a seed script that correctly binds session parameters to mock and insert tenant, project, trace, and memory records.

### 🟩 Phase 2 — Authentication & Context Isolation (Days 11–15)
* **Double-Client Database Split**:
  - `PrismaService` (Subject to RLS): Runs regular controller queries under the `observability_app` role.
  - `SystemPrismaService` (Bypasses RLS): Runs as `postgres` superuser for API key lookups in the auth guard.
* **AsyncLocalStorage Request Context**: Implemented a global middleware wrapping requests in an async storage boundary to store active project/tenant scopes.
* **API Key Auth Guard**: Custom `ApiKeyGuard` supporting Bearer token and `x-api-key` headers. Hashes keys with SHA-256 for secure database validation.
* **Automated RLS Injector**: Built a Prisma Client query extension that intercepts all operations, wrapping them in an interactive transaction that executes `SET LOCAL` variables dynamically. Utilizes an `isInRlsTransaction` context flag to prevent infinite recursion deadlocks.
* **Jest Integration Tests**: Created a full test suite utilizing Fastify's native `inject()` method to verify that RLS isolation blocks unauthorized project access.

### 🟩 Phase 3 — Telemetry Ingestion & Queue (Days 16–21)
* **Zod Payload Validation**: Implemented strict validation schemas for telemetry inputs to validate trace boundaries, timestamps, and nested span parameters.
* **Asynchronous Buffer Queue**: Configured global `BullModule` queue integration backed by the local Redis container instance.
* **POST /v1/traces Telemetry API**: Implemented a protected controller route that writes trace payloads to `RawTrace`, enqueues a processing job with the raw trace ID, and instantly returns `202 Accepted` to keep client latency low.
* **Idempotent Background Worker**: Implemented a `TraceProcessor` worker that:
  - Computes cumulative trace statistics: total tokens, costs, and span-boundary latency.
  - Groups spans into flat structures for batch inserts via `createMany`, resolving relations cleanly in Prisma.
  - Guarantees idempotency by checking and deleting existing trace duplicate records in a transaction before inserting updates.
* **Jest Test Coverage**: Created a test suite mock-testing enqueues, payload parsing, tree writes, and idempotency overrides.

### ⬜ Phase 4 — OpenTelemetry Mapping & Trace Costs (Days 22–27)
* *Next up: Map spans to standard OpenTelemetry semantic conventions and integrate pricing calculation rules for different LLM models.*

### ⬜ Phase 5 — Vector Search & Memory Tracing (Days 28–35)
* *Future: Implement Cosine Similarity search endpoints on pgvector embeddings, and trace memory read/write operations within span sub-graphs.*

### ⬜ Phase 6 — Webhook Alerting & Anomaly Engine (Days 36–45)
* *Future: Trigger real-time notifications on token cost spikes, model errors, or latency thresholds, and queue alerts to webhook endpoints.*

### ⬜ Phase 7 — Prometheus Metric Scopes & Grafana (Days 46–60)
* *Future: Expose custom Prometheus metrics (throughput, latency, token count, cost aggregate, queue load) and design dashboards for multi-tenant visualization.*

---

## How to Run Locally

### 1. Prerequisites
* Node.js (v18+)
* `pnpm` package manager
* Docker & Docker Compose

### 2. Setup Environment
Copy the example environment template:
```bash
cp .env.example .env
```

### 3. Spin Up Infrastructure Containers
Start Postgres, Redis, and Prometheus:
```bash
docker compose up -d
```
*(Note: Postgres is mapped to host port `5435` to avoid conflicts with native PostgreSQL servers running on `5432`.)*

### 4. Deploy Database & Seeding
Create the database user roles, apply migrations (creating tables, HNSW indexes, and RLS policies), and seed the database:
```bash
# 1. Authorize PNPM dependency builds (esbuild and prisma)
pnpm approve-builds

# 2. Run migrations
npx prisma migrate dev

# 3. Seed data
npx prisma db seed
```

### 5. Start Application Dev Server
```bash
pnpm run start:dev
```
The server will boot and listen on `http://localhost:3000`.

---

## Testing & Verification

### 1. Running Integration Tests
Run the automated Jest suite to verify authentication guards and RLS isolation rules:
```bash
npx jest src/auth/auth.spec.ts --preset ts-jest
```

### 2. Manual Curl Tests

* **Protected endpoint (unauthenticated)**:
  ```bash
  curl -i http://localhost:3000/health/protected
  # Returns 401 Unauthorized ("API key is missing")
  ```

* **Protected endpoint (Production Project Key)**:
  ```bash
  curl -i -H "Authorization: Bearer sk_live_prod_12345678abcdef" http://localhost:3000/health/protected
  # Returns 200 OK with Production context and traceCount = 1 (seeded trace)
  ```

* **Protected endpoint (Staging Project Key)**:
  ```bash
  curl -i -H "x-api-key: sk_test_stage_87654321fedcba" http://localhost:3000/health/protected
  # Returns 200 OK with Staging context and traceCount = 0 (RLS filtered out Production trace)
  ```
