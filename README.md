# ccopt — The Agent Waste Report

Graph-based determinism detection for AI agents. ccopt maps every run your Claude Code agents make, proves which runs are the same procedure repeated, and shows you — in dollars — what to cache, compile, downsize, or fix.

Implements the MVP scoped in the internal `ccopt-mvp-spec.md` (kept out of the public repo).

## How it works

1. **Capture** — Claude Code already writes a complete JSONL transcript per session to `~/.claude/projects/` including per-message token usage. ccopt parses those directly (zero-install). For programmatic/CI runs, `ccopt run --agent <id> -- claude -p "..."` tags the session with a logical agent identity.
2. **Canonicalize** — volatile literals (paths, IDs, timestamps, URLs, numbers, refs) are replaced with typed placeholders so "the same procedure on different data" hashes identically. Golden-file test suite in `packages/core/test/golden/`.
3. **Graph + fingerprint** — each run becomes a DAG (temporal + dataflow edges) with three fingerprints: **L0** (exact: structure + labels + canonical I/O), **L1** (shape: same procedure, different data — the money layer), **L2** (family: local n-gram TF-IDF cosine clustering of near-miss shapes; no API dependency).
4. **Findings** — per-cluster metrics (determinism score, failure rate, retry motifs, model mix, volatile slots) map to dollar-ranked findings: **Compile it / Cache it / Right-size it / Fix it / Precompute it / Align it**. Top 5 by `saving × confidence ÷ effort`.
5. **Report** — self-contained HTML with SVG graph chains + JSON artifact. Rendered identically by local mode and the hosted viewer.
6. **AI cost analysis (trigger-only)** — on demand, an LLM goes over the runs themselves (per-run digests: tools used, files/folders read, web fetches/searches, commands, prompt sizes, cache economics — every digest linked to its run graph) and produces actionable bullets: prompt reduction/caching, web-search → cached summary, deterministic segments → plain script or a smaller model for just that part of the graph, retry fixes. Every bullet carries an estimated monthly saving, an explicit **performance-risk** rating, and evidence runs. Nothing is generated before you ask.

## Hosted UI

All browser views authenticate with `?key=<tenant API key>`:

| Page | What |
|---|---|
| `/ui` | Workspace dashboard: agents (click to filter), AI cost analysis, reports, recent sessions. **Run optimization** button triggers the AI pass — gated so it only re-runs when ≥5 new runs arrived since the last analysis (`force` link to override). |
| `/r/:reportId` | The Waste Report (unguessable UUID, share-by-link). |
| `/s/:sessionId` | Full session transcript (owner key only, secrets redacted by default; `&reveal=1` shows raw). |
| `/g/:sessionId` | The run graph: canonical DAG with dataflow arcs + per-node canonical/raw I/O (owner key only, redacted by default). |
| `/c/:clusterId` | Procedure cluster: determinism verdict, the shape, volatile slots (the parameters), metrics, evidence runs. |

### Privacy model

API keys carry a **role**: `owner` or `member`. Member keys (teammates) can sync runs, see the dashboard/reports/clusters, and trigger optimizations — but raw session content (`/s`, `/g`) is owner-only. Even for the owner, credential-shaped values (vendor API keys, JWTs, PEM blocks, connection-string passwords, `*_SECRET=`/`password=` assignments) are **redacted at render**; `&reveal=1` shows raw content with an explicit banner. The same deep-redaction is applied to every packet sent to the analysis LLM, so tenant secrets never reach the model provider. (Honest limit: raw bytes still exist at rest in the blob store and Postgres — protect those credentials accordingly.)

Mint additional keys per tenant: `POST /api/v1/tenants/:tenantId/keys {"label":"…","role":"owner"|"member"}` with the admin token.

## Layout

| Package | What |
|---|---|
| `packages/core` | The engine: transcript parser, canonicalizer, graph builder, fingerprints, L2 clustering, metrics, finding mapper, report renderer |
| `packages/cli` | `ccopt analyze` (local-only mode), `ccopt sync` (upload), `ccopt run` (CI wrapper) |
| `packages/server` | SaaS shell: Fastify + Postgres + blob store (disk or any S3-compatible), tenants/API keys with roles, gzip ingest, trigger-only pipeline, hosted viewers (dashboard/report/session/graph/cluster), secret redaction, provider-agnostic AI insights |

## Install (customers / design partners)

ccopt ships as a single self-contained file — the only prerequisite is Node 20+. No npm install, no dependencies, no changes to your agents.

```bash
# one-liner (or run ./install.sh from a checkout):
curl -fsSL https://effigent.ai/install.sh | sh

ccopt doctor     # verifies capture, attribution, auth mode, and server reachability
ccopt analyze    # your first Waste Report, from transcripts you already have
```

`ccopt doctor` is the out-of-the-box check: it finds your existing Claude Code / Agent SDK transcripts (they're already being written — capture requires nothing), confirms they parse, and tells you exactly what's missing for isolated or hosted mode.

### Onboarding a teammate: one command

Whoever owns the workspace runs `ccopt invite [--agent <filter>]` and sends the printed line. The teammate pastes it:

```bash
curl -fsSL https://effigent.ai/install.sh | sh -s -- --join <token>
```

That single command installs ccopt, saves the workspace server + key + attribution rules, schedules a recurring sync (launchd on macOS, cron on Linux — every 15 minutes, filtered so unrelated local sessions stay private), verifies the API key, and uploads their existing history. The token embeds the workspace API key — share it privately.

For CI, the repo doubles as a **GitHub Action** (`action.yml`) so wrapping any agent is:

```yaml
- uses: effigent/effigent@main
  with:
    agent: dev-teammate:acme/api
    command: pnpm --filter @moonshot/cli exec tsx src/run.ts --repo acme/api --requirement "…"
    server: https://ccopt.yourcompany.com
    api-key: ${{ secrets.CCOPT_API_KEY }}
```

Rebuild the distributed file with `npm run bundle` (emits `dist/ccopt.cjs`, committed so the Action and raw-URL install work).

## Development quickstart

```bash
npm install && npm run build && npm test
```

### Local-only mode (privacy-sensitive partners, and dogfooding)

```bash
node packages/cli/dist/index.js analyze --days 30
open ccopt-report.html
```

### Demo (synthetic programmatic agents — the target-buyer shape)

```bash
node scripts/demo.mjs && open demo-report.html
```

### Hosted mode

```bash
docker compose up -d                        # Postgres on :5433
cd packages/server
CCOPT_ADMIN_TOKEN=dev-admin-token node dist/index.js   # migrates + listens on :8787

# create a tenant (returns the API key exactly once)
curl -X POST localhost:8787/api/v1/tenants \
  -H 'x-admin-token: dev-admin-token' -H 'content-type: application/json' \
  -d '{"name":"acme","email":"eng@acme.com"}'

# customer machine
ccopt sync --server http://localhost:8787 --key cck_…
curl -X POST localhost:8787/api/v1/analyze -H 'authorization: Bearer cck_…'
# → { reportUrl: "http://localhost:8787/r/<uuid>" }
```

Server env: `DATABASE_URL`, `CCOPT_ADMIN_TOKEN` (required), `CCOPT_DATA_DIR` (blob root, default `./data`), `PORT` (8787), `CCOPT_PUBLIC_BASE_URL`. **Everything is trigger-only** — there are no scheduled jobs; reports and AI analyses are generated exactly when requested.

### AI insights (trigger-only, provider-agnostic)

```bash
# one call = fresh deterministic report for the agent + the AI pass over its runs
curl -X POST "https://<server>/api/v1/insights?agent=<substr>&runs=40" \
  -H "authorization: Bearer cck_…"        # &force=1 bypasses the 5-new-runs freshness gate
```

The LLM is pluggable via env — no code change to switch providers:

| Env | Anthropic (default) | Any OpenAI-compatible endpoint |
|---|---|---|
| `CCOPT_LLM_PROVIDER` | `anthropic` | `openai-compatible` |
| `CCOPT_LLM_MODEL` | `claude-opus-4-8` (default) | e.g. `google/gemini-3.5-flash` (OpenRouter), `gpt-4o`, a local Ollama model |
| `CCOPT_LLM_BASE_URL` | — | e.g. `https://openrouter.ai/api/v1`, `http://localhost:11434/v1` |
| `CCOPT_LLM_API_KEY` | falls back to `ANTHROPIC_API_KEY` | falls back to `OPENAI_API_KEY` |

Other useful endpoints: `POST /api/v1/analyze?agent=` (deterministic report only), `GET /api/v1/agents` (tenant inventory), `GET /api/v1/reports`, `GET /api/v1/admin/overview` (all tenants, admin token).

### Production storage & free-tier deployment

Raw transcripts and report HTML go to the **blob store**; Postgres keeps metadata, parsed runs, clusters, and findings (pointers only to blobs). Two blob backends behind one interface, chosen by env:

- **Disk** (default): `CCOPT_DATA_DIR` — dev and single-box installs.
- **S3-compatible** (set `CCOPT_S3_BUCKET` + `CCOPT_S3_ENDPOINT` + `CCOPT_S3_ACCESS_KEY_ID` + `CCOPT_S3_SECRET_ACCESS_KEY` [+ `CCOPT_S3_REGION`, default `auto`]): works with Cloudflare R2, Backblaze B2, AWS S3, and MinIO (integration-verified against MinIO).

Recommended $0 pilot stack:

| Piece | Service | Free tier |
|---|---|---|
| Server | Render free web service (`render.yaml` blueprint, Docker) | sleeps when idle, wakes on request |
| Postgres | Neon | 0.5 GB, scales to zero, no expiry |
| Blobs | Cloudflare R2 | 10 GB + zero egress fees |

Deploy: create the Neon DB and R2 bucket (+ API token), push this repo, point Render at it (`render.yaml`), paste `DATABASE_URL` (with `?sslmode=require`) and the `CCOPT_S3_*` values, set `CCOPT_PUBLIC_BASE_URL` to the Render URL. Migrations run automatically on boot. Then `ccopt login --server https://<app>.onrender.com --key …` and every `ccopt invite` from that point embeds the stable public URL.

Capacity math: transcripts gzip ~10:1, so 10 GB of R2 ≈ hundreds of thousands of agent runs; Neon's 0.5 GB holds the trimmed parsed runs for a multi-partner pilot. The first paying customer funds the jump to paid tiers long before either limit.

### Capturing any agent — standalone, zero changes to the target

ccopt never requires code changes in the agent it observes. Anything built on Claude Code or the Claude Agent SDK already writes complete session transcripts to `~/.claude/projects/`; ccopt attributes them three ways:

```bash
# 1. Wrap ANY agent command (CI/cron). Sessions written during the run are
#    attributed by snapshot diff — works for SDK-based agents that spawn their
#    own sessions (direct `claude` commands additionally get --session-id injected):
ccopt run --agent dev-teammate:acme/api -- pnpm --filter @moonshot/cli exec tsx src/run.ts --repo acme/api --requirement "…"
ccopt run --agent nightly-feed-sync -- claude -p "Sync the product feed"

# 2. Tag existing sessions after the fact:
ccopt tag --agent dev-teammate:acme/api <session-id> …

# 3. Do nothing: untagged sessions fall back to agentId = the run's working
#    directory name (fine for agents with a stable checkout path).
```

Mappings live in `~/.ccopt/agent-map.d/` (one file per session — safe under concurrent wrappers; the legacy `agent-map.json` is still read); `analyze` and `sync` both apply them. Caveat for the plain wrapper: concurrent sessions on the same machine during the window are attributed too — use `--isolated` when more than one agent runs at a time.

### Multiple agents & cloud machines

Two flags turn the wrapper into a complete fleet story:

- **`--isolated`** — the wrapped agent gets a private `CLAUDE_CONFIG_DIR` (honored by Claude Code and the Agent SDK's spawned processes), so its transcripts land in a per-run store. Attribution is exact and any number of agents can run concurrently on one machine. Requires env-based auth (`ANTHROPIC_API_KEY` / Bedrock / Vertex) or file-based credentials; macOS keychain logins don't carry into an isolated dir. Captured transcripts are preserved in `~/.ccopt/store/` so local `analyze` still sees them.
- **`--server <url> --key <key>`** (or env `CCOPT_SERVER` / `CCOPT_API_KEY`) — transcripts are uploaded to the ccopt service the moment the wrapped command exits, attributed via header. This is the ephemeral-machine path: nothing needs to survive on the runner.

Example — dev-teammate as a cloud agent in GitHub Actions:

```yaml
jobs:
  dev-teammate:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
        with: { repository: your-org/dev-teammate }
      - run: pnpm install && pnpm build
      - name: Run dev-teammate under ccopt
        env:
          ANTHROPIC_API_KEY: ${{ secrets.ANTHROPIC_API_KEY }}
          CCOPT_SERVER: https://ccopt.yourcompany.com
          CCOPT_API_KEY: ${{ secrets.CCOPT_API_KEY }}
        run: |
          npx ccopt run --agent "dev-teammate:${{ inputs.repo }}" --isolated -- \
            pnpm --filter @moonshot/cli exec tsx src/run.ts \
              --repo "${{ inputs.repo }}" --requirement "${{ inputs.requirement }}"
```

Each repo (or workflow) gets its own `--agent` id; the hosted report then breaks findings out per agent, and same-shape runs across the fleet cluster per agent id.

## Honest limitations (say this to customers too)

- The engine proves **procedural repetition** and prices it from recorded usage; it cannot prove a future run stays deterministic. Determinism is a score, not a promise.
- L0 "identical" means identical **after canonicalization** — e.g. two deploys differing only in version number count as L0-equal. That is the intended cache-key semantics, but review the evidence runs before wiring a cache.
- L1 serialization is exact for near-linear chains (the observed reality); true DAG fan-out is serialized in emission order — a documented approximation.
- Interactive sessions rarely repeat shapes; the money is in programmatic agents (CI, cron, pipelines). Expect low cluster ratios on interactive-only history.
- Deferred by design (spec §2): script synthesis flagship action, router front-door, live monitoring, auto-apply, multi-runtime, billing.

## Status vs the 6-week plan

- **W1–W3 (capture, canonicalizer + golden tests, graphs, fingerprints, clustering, metrics, findings, report):** done.
- **W4 (flagship script synthesis + replay validation):** not built yet — next.
- **W5 (SaaS shell: tenants/keys, sync, hosted viewers; L2):** done — extended beyond the plan with per-run graph/session/cluster viewers, key roles + secret redaction, and the trigger-only, provider-agnostic AI cost analysis. (Scheduled weekly email was cut by owner decision: everything is on-demand.)
- **W6 (design partners):** go get them.
