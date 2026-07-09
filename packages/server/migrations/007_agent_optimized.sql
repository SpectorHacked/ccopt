-- Marks when an agent has been through an optimization pass. The dashboard shows
-- an "Optimized" indicator when this is set. Null = not yet optimized. Idempotent.
alter table agents add column if not exists optimized_at timestamptz;
