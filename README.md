# AI Agent Observability Platform

A production-grade, high-throughput, multi-tenant backend platform designed to ingest, trace, and monitor AI agent executions in real-time. It enables developers to debug nested LLM chains, analyze tool executions, calculate exact token costs, receive real-time anomaly alerts, and query agent memory.

Think of it as a developer-first, self-hosted alternative to platforms like **Langfuse**, **Helicone**, and **AgentOps**.

---

## What the Platform Does

When AI agents execute in production, a single user prompt triggers a cascade of hidden, nested steps (e.g., database queries, LLM completions, tool calls, and memory lookups). If an agent enters an infinite loop, errors out, or experiences a latency spike, debugging becomes extremely difficult.

This platform solves this by providing:
*   **Hierarchical Execution Tracing**: Automatically organizes flat spans into parent-child trees showing the exact execution flow of your agent.
*   **Multi-Tenant Isolation**: Enforces strict database Row-Level Security (RLS) ensuring that no tenant or project can view another's traces or memories.
*   **Dynamic LLM Cost Tracking**: Standardizes OpenTelemetry GenAI semantic conventions to extract token counts, lookup provider rates, and aggregate costs in real-time.
*   **Vector Memory Search**: Stores 1536-dimensional embeddings with cosine similarity distance filters to track and search what your agent remembers.
*   **Real-Time Alerts (Anomaly Engine)**: Evaluates completed spans for model failures, cost spikes, and latency issues, enqueuing self-retrying signed webhooks.
*   **Prometheus Monitoring**: Exposes a `/metrics` scrape endpoint reporting performance metrics labeled by tenant and project for Grafana dashboard visualization.

---

## Rough Design & Architecture

The system uses an asynchronous, decoupled architecture to process high-throughput trace ingestion while ensuring client response times remain under a few milliseconds:

```mermaid
graph TD
    Client[Client AI Application] -->|1. POST /v1/traces| API[NestJS Fastify API]
    API -->|2. Validate & Hashed Auth| Guard[ApiKeyGuard]
    Guard -->|3. Establish Context| ALS[AsyncLocalStorage Context]
    API -->|4. Push Raw Trace| Queue[(Redis / BullMQ)]
    API -->|5. Return 202 Accepted| Client
    
    Queue -->|6. Process Asynchronously| Worker[Background Worker]
    Worker -->|7. Parse Spans & Hierarchy| Prisma[Prisma Service]
    Prisma -->|8. Apply RLS session variables| DB[(PostgreSQL + pgvector)]
    
    Worker -->|9. Check Anomaly Rules| Engine[Anomaly Engine]
    Engine -->|10. Alert| Webhook[Webhook Outbox Queue]
    
    Prometheus[Prometheus Metrics] -->|Scrape /metrics| API
    Grafana[Grafana Dashboard] -->|Visualize Metrics| Prometheus
```

### Request Lifecycle
1.  **Ingestion**: The client application posts trace payloads to `/v1/traces` using API key authorization headers.
2.  **Context Binding**: The auth guard checks the key, finds the matching project, and registers the project/tenant context in `AsyncLocalStorage`.
3.  **Decoupled Queueing**: The API writes the raw payload to the database and immediately pushes an ingestion job to a BullMQ Redis queue, returning a `202 Accepted` response.
4.  **Worker Processing**: A background consumer picks up the job, resolves span relationships, computes token costs, detects anomalies, and registers Prometheus metrics.
5.  **Alert Delivery**: If anomalies are detected, a delivery job is pushed to the webhook queue, which sends an HMAC-SHA256 signed POST request to the tenant's webhook listener.

---

## Key Design Decisions

### 1. Row-Level Security (RLS) Database Isolation
To ensure absolute data security in a multi-tenant application, we enabled PostgreSQL Row-Level Security on all telemetry tables. Instead of relying on manual application-level `WHERE tenant_id = x` filters (which are prone to developer omission errors), database policies are enforced at the connection level:
*   **Dual-Prisma Client Split**:
    *   `PrismaService`: Runs regular queries connecting via a restricted non-superuser role (`observability_app`).
    *   `SystemPrismaService`: Connects as the superuser (`postgres`) to validate API keys before context is active and run background workers.
*   **Automatic RLS Transaction Injection**: Every database query executed by `PrismaService` is automatically wrapped in an interactive transaction that runs session configuration variables (`SET LOCAL app.current_tenant_id` and `SET LOCAL app.current_project_id`) prior to query execution.

### 2. Thread-Safe Context Propagation via `AsyncLocalStorage`
We wrapped Fastify requests inside `AsyncLocalStorage` boundaries. This allows deep nested services (like the Prisma RLS extension) to read the active request's `tenantId` and `projectId` implicitly without having to pass context objects through every method parameter in the application.

### 3. Decoupled Processing (BullMQ + Redis)
Trace payloads contain hundreds of nested spans. Parsing tree graphs and executing cost mappings synchronously would slow down client API response times. By buffering incoming payloads inside a Redis-backed BullMQ queue, we guarantee the API remains ultra-responsive under high-throughput conditions.

### 4. Cryptographic Webhook Signing
Webhooks are signed using HMAC-SHA256 signatures generated with a tenant-configured secret. The signature is sent in the `X-Webhook-Signature` header, allowing the receiver server to verify the request payload is authentic and has not been spoofed or modified.

---

## Exposed Prometheus Metrics

The `/metrics` endpoint exposes custom application metrics formatted in standard Prometheus exposition format. Multi-tenant metrics feature `tenant_id` and `project_id` labels to support isolated dashboards in Grafana:

| Metric Name | Type | Labels | Description |
| :--- | :--- | :--- | :--- |
| `observability_traces_ingested_total` | Counter | `tenant_id`, `project_id`, `status` | Cumulative number of ingested traces |
| `observability_spans_total` | Counter | `tenant_id`, `project_id`, `type` | Cumulative span count by type (`LLM`, `TOOL`, etc.) |
| `observability_tokens_total` | Counter | `tenant_id`, `project_id`, `type` | Cumulative prompt/completion token count |
| `observability_cost_usd_total` | Counter | `tenant_id`, `project_id` | Cumulative USD expenditure of LLM requests |
| `observability_trace_latency_ms` | Histogram | `tenant_id`, `project_id` | Latency distribution of processed traces |
| `observability_queue_jobs_total` | Gauge | `queue_name`, `status` | Backlog sizes of trace and webhook queues |

---

## Technology Stack

*   **Runtime & Framework**: TypeScript, NestJS (Fastify Adapter)
*   **Database & ORM**: PostgreSQL 16, pgvector (vector storage), Prisma ORM
*   **Queueing & Buffering**: Redis 7, BullMQ
*   **Metrics & Diagnostics**: prom-client, Prometheus, Grafana
*   **Validation**: Zod (for payload and env schema validation)

---

## Setup & Running Guide

### 1. Prerequisites
Ensure you have the following installed:
*   [Node.js](https://nodejs.org/) (v18+)
*   [pnpm](https://pnpm.io/) package manager
*   [Docker & Docker Compose](https://www.docker.com/)

### 2. Configure Environment
Copy the configuration template to set up database ports, queue passwords, and secrets:
```bash
cp .env.example .env
```

### 3. Spin Up Infrastructure Containers
Start local PostgreSQL (mapped to `5435` to avoid host conflicts), Redis (`6379`), and Prometheus (`9090`):
```bash
docker compose up -d
```

### 4. Apply Migrations & Database Seeding
This creates the tables, compiles the vector `HNSW` indexes, sets up RLS policies, and inserts mock test data:
```bash
# Apply database schema
npx prisma db push

# Seed mock tenants, projects, API keys, and memory vectors
npx prisma db seed
```

### 5. Run the Application
Start the development server:
```bash
npm run start:dev
```
The server will boot on `http://localhost:3000`.

### 6. Verification & Ingestion Testing

#### Submit a Trace Payload (OTel Format)
You can ingest a trace containing nested LLM spans using a seeded API key:
```bash
curl -i -X POST http://localhost:3000/v1/traces \
  -H "Content-Type: application/json" \
  -H "x-api-key: sk_live_prod_12345678abcdef" \
  -d '{
    "id": "trace-manual-test-1",
    "name": "OTel Test Trace",
    "status": "SUCCESS",
    "spans": [
      {
        "id": "11111111-2222-3333-4444-555555555555",
        "type": "LLM",
        "name": "gpt-4o API Call",
        "status": "SUCCESS",
        "startTime": "2026-07-04T12:00:00.000Z",
        "endTime": "2026-07-04T12:00:01.000Z",
        "metadata": {
          "gen_ai.system": "openai",
          "gen_ai.request.model": "gpt-4o",
          "gen_ai.usage.prompt_tokens": 1000,
          "gen_ai.usage.completion_tokens": 500
        }
      }
    ]
  }'
```

#### Query Prometheus Metrics
Retrieve application metrics:
```bash
curl http://localhost:3000/metrics
```

#### Run Automated Integration Tests
Execute the full NestJS test suite:
```bash
npx jest src/common/guards/api-key.guard.spec.ts src/memory/memory.spec.ts src/telemetry/telemetry.spec.ts src/webhook/webhook.spec.ts src/metrics/metrics.spec.ts --preset ts-jest --runInBand
```
