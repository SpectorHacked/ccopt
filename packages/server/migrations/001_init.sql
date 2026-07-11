-- effigent SaaS control plane — spec §4: "One managed Postgres, ~8 tables, no exotica."
-- Content (raw transcripts, rendered HTML) lives in the blob store; Postgres holds
-- metadata + cluster/finding rows + pointers.

create extension if not exists pgcrypto;

create table if not exists tenants (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  email text,
  created_at timestamptz not null default now()
);

create table if not exists api_keys (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references tenants(id) on delete cascade,
  key_hash text not null unique,
  label text,
  created_at timestamptz not null default now(),
  last_used_at timestamptz
);

create table if not exists uploads (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references tenants(id) on delete cascade,
  session_id text not null,
  agent_id text,
  blob_path text not null,
  bytes integer not null,
  status text not null default 'received', -- received | parsed | failed
  error text,
  received_at timestamptz not null default now()
);

create table if not exists runs (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references tenants(id) on delete cascade,
  session_id text not null,
  agent_id text not null,
  started_at timestamptz,
  ended_at timestamptz,
  cost_usd numeric not null default 0,
  models jsonb not null default '[]',
  n_steps integer not null default 0,
  blob_path text not null,
  parsed jsonb not null,
  created_at timestamptz not null default now(),
  unique (tenant_id, session_id)
);
create index if not exists runs_tenant_agent on runs (tenant_id, agent_id);

create table if not exists reports (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references tenants(id) on delete cascade,
  generated_at timestamptz not null default now(),
  window_days numeric not null,
  totals jsonb not null,
  report_json jsonb not null,
  html_blob_path text not null,
  emailed_at timestamptz
);
create index if not exists reports_tenant_time on reports (tenant_id, generated_at desc);

create table if not exists clusters (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references tenants(id) on delete cascade,
  report_id uuid not null references reports(id) on delete cascade,
  cluster_key text not null,
  agent_id text not null,
  l1 text not null,
  family_id text not null,
  n_runs integer not null,
  total_cost_usd numeric not null,
  determinism numeric not null,
  metrics jsonb not null,
  label_sequence jsonb not null
);
create index if not exists clusters_report on clusters (report_id);

create table if not exists cluster_runs (
  cluster_id uuid not null references clusters(id) on delete cascade,
  run_id uuid not null references runs(id) on delete cascade,
  primary key (cluster_id, run_id)
);

create table if not exists findings (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references tenants(id) on delete cascade,
  report_id uuid not null references reports(id) on delete cascade,
  kind text not null,
  title text not null,
  agent_id text not null,
  est_monthly_saving_usd numeric not null,
  confidence numeric not null,
  effort integer not null,
  score numeric not null,
  payload jsonb not null
);
create index if not exists findings_report on findings (report_id);
