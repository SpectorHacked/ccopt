# Optimizer (`ccopt`) — engineering guide

> A self-optimizing runtime for AI agents. Observe agent executions → normalize them
> into a universal execution **DAG** (intermediate representation) → progressively
> convert repetitive LLM reasoning into **deterministic** execution (synthesized tools,
> grep/AST, knowledge-graph retrieval, model routing, caching) → **validate** each
> optimization before it activates. In one line: **a compiler for AI agents** — it
> compiles at the LLM/tool boundary.

This file is the source of truth for how the repo is laid out and how the pieces fit.
Keep it current when you change architecture, data model, or deployment.

---

## 1. Monorepo layout

npm workspaces (`packages/*`). TypeScript throughout; ESM (`.js` import specifiers in source).

| Package | What it is | Runtime / host |
|---|---|---|
| `@ccopt/core` | Pure TS engine: transcript/OTel → `Run` → `RunGraph` (DAG), clustering, cost, taxonomy, **determinism scoring**. No I/O. | library |
| `@ccopt/server` | Fastify API: ingest, agents/keys, insights (LLM), analyze, reports, viewers. **Being retired** (see §6). | Node (Render) |
| `@ccopt/cli` | `ccopt` CLI: `login`, `agent add`, `install claude`, `claude-hook`, upload. | Node |
| `@ccopt/dashboard` | Next.js App Router dashboard + its own API routes. The product UI. | Vercel |
| `@ccopt/site` | Marketing site, Next.js **static export** (`output: 'export'`). | S3 + CloudFront |

The engine (`core`) is deliberately I/O-free so both capture paths (Claude transcripts
and OTLP spans) produce the **same `Run`**, and everything downstream is unchanged.

---

## 2. The core engine (`packages/core/src`)

The data contract everything else depends on.

- **`types.ts`** — `RawStep` (`kind`: `model_turn | tool_use | tool_result | thinking`,
  `name`, `payload`, `isError?`, `toolUseId?`), `TokenUsage` (Anthropic-style:
  input / output / cacheCreation / cacheRead), `Run`, `GraphNode`, `RunGraph`.
- **`transcript.ts`** — `parseTranscript()`: Claude Code JSONL → `Run` (returns null if no
  assistant turn / tool use).
- **`otel.ts`** — `otelToRuns()` + `normalizeGenAiUsage()`: OTLP GenAI spans → `Run[]`.
  Anthropic usage maps 1:1; OpenAI (`prompt_tokens` includes cached) is normalized to the
  uncached remainder.
- **`graph.ts`** — `buildRunGraph()`: `Run` → `RunGraph` with fingerprints
  **L0** (structure + labels + canonical I/O), **L1** (structure + labels = *shape*),
  and a canonical `labelSequence`. Clustering groups runs by these.
- **`cost.ts`** — `usageCostUsd(model, usage)`: regex-priced per model tier (unknown model
  falls back to the sonnet tier — never zero, so a mis-guess only mildly mis-estimates).
- **`taxonomy.ts`** — classifies tool names (unknown tools degrade to `side_effect`).
- **`determinism.ts`** — **the brain's MVP.** `scoreDeterminism(graphs)` groups runs by L1
  (shape), and for each node compares `canonicalValue` across runs:
  `agreement = modalCount / runCount`, `score = round(agreement * 100)`,
  `actionFor`: **≥90 → replace** (with a tool), **70–89 → cache**, **<70 → keep**.

---

## 3. Data model (Postgres / Neon)

Migrations in `packages/server/migrations/` run on server boot in lexical order. **No
tracking table** — every statement must be idempotent (`if not exists`, `on conflict`).

| Table | Purpose | Notable columns |
|---|---|---|
| `tenants` | A workspace. One per Clerk org / personal user. | `clerk_ref` (`org:<id>` / `user:<id>`, partial-unique) |
| `api_keys` | `cck_` capture/tenant keys (sha256-hashed). | `role` (`owner`/`member`), `agent_id` (scoped keys) |
| `agents` | Registered agents. | `name` (unique per tenant), `harness`, **`optimized_at`** |
| `runs` | One session / invocation. | `session_id`, `agent_id` (name), `cost_usd`, `models` (jsonb), `n_steps`, `blob_path`, **`parsed`** (trimmed `Run` jsonb), `graph_blob_path` |
| `reports`, `clusters`, `cluster_runs`, `findings` | Analysis output. | |

Migrations of note: `003` agents + scoped keys, `004` run-graph pointer, `006` Clerk
tenant ref, **`007` `agents.optimized_at`** (the Optimized indicator).

`runs.agent_id` stores the agent **name** (keeps the engine/queries stable); `agents.id`
binds credentials only.

---

## 4. Auth & tenancy

- **Agents** authenticate with `cck_<hex>` keys (hashed). Scoped keys are `role='member'`
  and bound to one `agent_id`.
- **Dashboard users** authenticate with **Clerk** (`@clerk/nextjs` v6, `clerkMiddleware`).
- A **Clerk Organization is a tenant**; a user with no active org gets a personal tenant.
  `resolveTenant({ userId, orgId })` (in `dashboard/src/lib/tenant.ts`) find-or-creates by
  `clerk_ref` and mints a default owner key.

Secrets live in `.env.local` (gitignored) and in Vercel — **never commit them**. The Clerk
secret key stays server-only (no `NEXT_PUBLIC_` prefix).

---

## 5. Dashboard (`packages/dashboard/src`)

Next.js App Router. `tsconfig` allows `.ts`/`.tsx` import specifiers; `@/*` → `src/*`.
Reads Neon directly via a pooled `pg` client (`lib/db.ts`).

**API routes** (all Clerk-auth'd, `resolveTenant`, `force-dynamic`):
- `GET /api/v1/agents` — per-agent rollup from `runs`: `n_runs`, `total_cost_usd`,
  `models`, `optimized` (guarded if `optimized_at` column absent).
- `GET /api/v1/sessions[?agent=]` — the tenant's runs, newest first.
- `GET /api/v1/sessions/[id]` — one run (with `parsed`) for the DAG deep-dive.

**Views** (`Dashboard.tsx` drives `view` state; sidebar in `data.ts` `nav`):
- **Overview** — KPI tiles, per-agent **Execution Graph** (original vs optimized), and
  the demo analytics rail/bottom.
- **Sessions** — one-stop shop: totals strip (agents / sessions / spend), per-agent totals
  cards, **session-id search**, and a table where each row opens the…
- **…DAG deep-dive** (`SessionDetail.tsx`) — sticky run context, per-model **usage table**,
  and a scrollable numbered **trace** (tool-call→result grouping, per-node model/tokens/
  duration, click-to-expand payloads).
- **Tool Synthesis** / **Knowledge Graph** (per-agent) — currently demo-backed.
- **Install** — how to put Optimizer on an agent (see §6 for real vs aspirational).

**What is real vs demo, today:**
- **Real (DB-driven):** agent list, totals, sessions, DAG deep-dive, per-model usage,
  the Optimized indicator (`optimized_at`).
- **Demo (in `data.ts`, not yet wired to the engine):** KPI tile values, Execution Graph
  flows (per-agent but hand-authored), Tool Synthesis, Knowledge Graph counts, the rail
  analytics. These are the target-state design; swap for engine output as it lands.

Styling: `theme.css` (design tokens as CSS vars, dark theme).

---

## 6. Deployment & the collector (honest status)

**Target architecture:** dashboard (Vercel + Clerk) + Neon + R2, no Render.

- **Site** → S3 + CloudFront, auto-deployed by `.github/workflows/deploy-frontend.yml`
  on push (uses the `prod` GitHub Environment + AWS secrets).
- **Dashboard** → Vercel, auto-deploys on push to `main`.

**⚠️ The install path is NOT end-to-end yet.** The dashboard only *reads* Neon — it has no
ingest endpoint. The real collector endpoints (`POST /api/v1/ingest` for Claude
transcripts, `POST /v1/traces` for OTLP) live in `packages/server` (Fastify, on Render,
being retired) and write raw transcripts to **R2** (`CCOPT_S3_*`) + parsed runs to Neon.
The install snippets point at placeholder domains (`app.optimizer.ai`), and the CLI isn't
published. To make install real:
1. Port `ingest` + `/v1/traces` into the **dashboard's Next.js API** (or a Lambda) so they
   write to the same Neon the dashboard reads.
2. Wire `CCOPT_S3_*` to the existing R2 bucket — **one bucket, tenant-prefixed keys**
   (`<tenantId>/transcripts/…`); do **not** create a bucket per tenant/agent.
3. Publish the CLI and put real base URLs in the install snippets.

---

## 7. Seed / demo data

The prod dashboard reads prod Neon, which was wiped. To make the demo look populated:

- **`scripts/seed-prod.mjs`** — inserts synthetic sessions for a tenant. 6 agents
  (`invoice-reconciliation`, `repo-explorer`, `support-triage`, `ci-fixer`, `docs-writer`,
  `data-pipeline`), deep runs (10–16 steps) with real tool inputs+outputs, per-step
  model/tokens/ms, and model routing (multi-model runs). Rows are prefixed `seed-`.
  ```
  PROD_DATABASE_URL="postgres://…?sslmode=require" node scripts/seed-prod.mjs --list
  PROD_DATABASE_URL=…  node scripts/seed-prod.mjs --ref <clerk_ref-substr>
  # cleanup:  delete from runs where session_id like 'seed-%';
  ```
- **`scripts/mark-optimized.mjs`** — applies `agents.optimized_at` (migration 007),
  ensures an `agents` row per agent, and marks agents optimized so the indicator shows.
  ```
  PROD_DATABASE_URL=…  node scripts/mark-optimized.mjs --agent invoice-reconciliation
  ```

The org tenant (`org:org_…`) is created lazily on first dashboard load; scripts target it
by `--ref`.

---

## 8. Roadmap — the brain

The "brain" turns observed runs into activated optimizations. Sequenced:

1. **Determinism analysis (MVP)** — run `core/determinism.ts` over a tenant's stored runs
   (grouped per agent by L1 shape) → per-node action items (replace / cache / keep).
   Surface as an "Insights / Action Items" view. *`scoreDeterminism` already exists; needs
   to run server-side over `runs.parsed` and render.*
2. **AI analyst** — an LLM pass over ~30 runs + the determinism signal → prioritized,
   human-readable action items with estimated savings.
3. **DAG diff** — compare a run's graph across versions to measure how much a graph changed
   after an optimization (the real "original vs optimized" for the Execution Graph).
4. **The gateway** — the injection vehicle (proxy `base_url` / sidecar / Lambda) that
   actually *enforces* an optimization at the LLM/tool boundary.

---

## 9. Conventions

- **Migrations are idempotent** and run on boot; never assume a tracking table.
- **Never commit secrets.** `.env.local`, `.env*.local`, `.next/`, `out/` are gitignored.
- **Prod DB writes:** data seeds are fine; **schema changes (ALTER)** are gated in
  auto-mode — run them explicitly (the `mark-optimized` script, or `!`-prefixed).
- **`parsed` is free-form jsonb** — the dashboard reads it directly (no `core` dep on
  Vercel). Seed data may carry richer per-step fields (`model`, `tokens`, `ms`) that the
  OTLP capture path also provides.
- Commit messages end with the `Co-Authored-By` trailer; branch before committing on `main`
  only when asked.

## 10. Common commands

```
npm install                              # bootstrap workspaces
npm run -w @ccopt/dashboard build        # typecheck + build the dashboard
npm run -w @ccopt/dashboard dev          # local dashboard (needs .env.local)
npm run -w @ccopt/core build             # build the engine (dist/)
```
