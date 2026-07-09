-- Per-tenant plan limits. max_agents: how many distinct agents may be
-- registered (null = use the application default). Idempotent.
alter table tenants add column if not exists max_agents integer;
