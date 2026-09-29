-- Bilang MVP-1 schema (Supabase / Postgres)
--
-- Two tables, deliberately kept separate:
--   1. bilang.splits          — operational data the app needs to function
--   2. bilang.bill_analytics  — genuinely anonymised, aggregate-only capture (roadmap F7a)
--
-- Both tables live under a dedicated `bilang` schema, not `public`
-- (Open Item 21, decided 2026-09-29 — Alex wants a dedicated schema "for more
-- scrutiny over database access"). This file MOVES the tables rather than
-- dropping and recreating them: `alter table ... set schema` preserves every
-- existing row and column definition, and the table no longer exists under
-- `public` afterwards — nothing is left behind in the old location. This is
-- deliberately safer than a drop-and-recreate, which would destroy any rows
-- already stored, and was flagged to Alex as the default approach unless he
-- wanted drop/recreate instead.
--
-- Manual setup step for Alex: paste this whole file into the Supabase
-- dashboard's SQL Editor (Project -> SQL Editor -> New query) and run it once.
-- Nothing in this repo runs migrations automatically — this .sql file is the
-- single source of truth for the schema and is applied by hand.
--
-- >>> RUN THIS IN BOTH DATABASES <<<
-- This file must be applied to BOTH the test database (`paeveul-as-testdb`)
-- now, and later to the production database, before Item 24 (payer
-- item-claiming) ships to production (Open Item 20). Re-running it is safe
-- either way — every statement below is idempotent (see the per-step notes).
--
-- >>> DASHBOARD SETTING THIS FILE CANNOT SET <<<
-- After running this SQL, go to Settings -> API in the Supabase dashboard for
-- THIS project and add `bilang` to "Exposed schemas". PostgREST (the API
-- layer Supabase's client libraries talk to) only serves schemas listed
-- there; `public` is listed by default but a custom schema is not. Until
-- this is done in the dashboard, the app's Supabase client will get an error
-- trying to reach `bilang.splits` / `bilang.bill_analytics`, even though the
-- SQL below succeeded. This setting is per-project, so it must be repeated
-- separately for the test project and (later) the production project — this
-- file cannot do it; it is a dashboard click only.

-- Schema itself. A custom schema has no automatic grants (unlike `public`,
-- which Postgres/Supabase grants USAGE on to every role by default), so the
-- schema-level grant below is required before any table-level grant means
-- anything.
create schema if not exists bilang;
grant usage on schema bilang to service_role;

-- Move the tables out of `public` if they were created there by an earlier
-- run of this file (true for the test database, which already ran the
-- original public-schema version). Wrapped in existence checks so this is
-- safe to run on a database that has never had this schema applied at all
-- (true for a fresh production database) — in that case these blocks are a
-- no-op and the `create table if not exists bilang.*` statements further
-- down create the tables directly under `bilang`.
do $$
begin
  if exists (
    select 1 from information_schema.tables
    where table_schema = 'public' and table_name = 'splits'
  ) then
    alter table public.splits set schema bilang;
  end if;
end $$;

do $$
begin
  if exists (
    select 1 from information_schema.tables
    where table_schema = 'public' and table_name = 'bill_analytics'
  ) then
    alter table public.bill_analytics set schema bilang;
  end if;
end $$;

-- Note on indexes: there is no `alter index ... set schema` command in
-- Postgres — an index always lives in the same schema as its table and is
-- not independently schema-qualified. `alter table ... set schema` above
-- already moved `splits_expires_at_idx` along with `splits` automatically;
-- nothing further is needed for it. (Verified against Postgres's ALTER INDEX
-- grammar, which supports RENAME TO / SET TABLESPACE / SET storage
-- parameters / OWNER, but not SET SCHEMA — that action exists only on
-- ALTER TABLE, ALTER FUNCTION/PROCEDURE, and a handful of other object
-- kinds, not indexes.)

create table if not exists bilang.splits (
  id                    text primary key,          -- short public id, e.g. "K7mP2xQaN" (see api/_lib/validate.js)
  items                 jsonb not null,             -- array of {id, name, category, qty, unit_price, line_total}
  assignments           jsonb not null,             -- { [itemId]: [payerName, ...] }
  totals                jsonb not null,              -- { subtotal, service_charge, tax, grand_total }
  owner_payment_handle  text not null,               -- DuitNow ID / bank account / QR string — display-only, never validated
  created_at            timestamptz not null default now(),
  expires_at            timestamptz not null          -- retention window; see RETENTION_DAYS in .env.example
);

-- Item 24 (payer item-claiming) — additive columns on `bilang.splits`.
-- Idempotent: safe to re-run, and safe on a database that already holds rows
-- (existing splits get payers = NULL and version = 0; nothing is backfilled,
-- splits expire in RETENTION_DAYS anyway). Apply by hand like the rest of this
-- file. Nothing in the app reads or writes these columns until the Item 24
-- code steps land, so applying this early breaks nothing. Targets
-- `bilang.splits` (not `public.splits`) because by the time anyone runs this
-- file the table has already moved to `bilang` by the block above.
--   payers  — ordered roster of payer names (jsonb array of strings). NULL on
--             splits created before this column existed; those cannot be
--             claimed against.
--   version — compare-and-swap counter, bumped by every successful claim write.
alter table bilang.splits add column if not exists payers  jsonb;
alter table bilang.splits add column if not exists version integer not null default 0;
--
-- Rollback (manual; destroys the stored rosters / counters, so only before
-- claiming ships or if the data is disposable):
--   alter table bilang.splits drop column if exists version;
--   alter table bilang.splits drop column if exists payers;

-- Speeds up the future MVP-3 cleanup job's `WHERE expires_at < now()` sweep.
create index if not exists splits_expires_at_idx on bilang.splits (expires_at);

-- Anonymised, de-identified analytics dataset (roadmap F7a — MVP-1 scope,
-- capture only; reporting/aggregation against it is MVP-3 scope).
--
-- Deliberately minimal: item category, amount, timestamp — nothing else.
-- No name, no payment handle, and NO foreign key back to `splits.id`. This is
-- a genuine severance (true anonymisation), not mere pseudonymisation — see
-- Howard's technical assessment §5 amendment and the roadmap's E1/F7
-- discussion for why that distinction is load-bearing, not cosmetic. Do not
-- add a split_id column to this table.
create table if not exists bilang.bill_analytics (
  id             bigserial primary key,
  item_category  text not null check (item_category in ('food', 'drink', 'tax', 'service', 'other')),
  amount         numeric not null,
  created_at     timestamptz not null default now()
);

-- Row Level Security (closes Open Item 19's flagged gap — confirmed with
-- Alex 2026-09-29, before this file was first applied to any database).
-- This is the same posture already used by every other Bilang table in the
-- implementation plan (accounts, terms_acceptances, payment_purchases,
-- payment_events, the credit_lots/holds/transactions/shortfalls group,
-- account_holds, automation_runs — see
-- bilang/technical/bilang-mvp1-implementation-plans.md): RLS enabled, no
-- policies, denying every row to every role by default. `splits` and
-- `bill_analytics` predate that pattern being established and were the two
-- tables Open Item 19 flagged as missing it.
--
-- This is a second, independent lock, not a duplicate of the GRANT/REVOKE
-- block below: GRANT decides whether a role can touch the table at all; RLS
-- then filters which rows it's allowed to see. Bilang's server (see
-- api/_lib/supabase.js) uses exclusively the service_role key, which
-- bypasses RLS entirely either way — so this does not change app behaviour
-- today. What it buys is a second-layer safety net: if anon or authenticated
-- were ever accidentally granted table access later (a GRANT mistake), RLS
-- with no policies still blocks them from reading or writing any row.
-- Idempotent — re-enabling RLS on a table that already has it is a no-op.
alter table bilang.splits enable row level security;
alter table bilang.bill_analytics enable row level security;

-- Grants (Open Item 19 — Supabase's Oct-30 notice: new/custom-schema tables
-- get NO automatic grants, unlike a first-party table under `public`, which
-- Supabase seeds with default privileges today). Bilang's server (see
-- api/_lib/supabase.js) is the ONLY caller and it uses exclusively the
-- SUPABASE_SERVICE_ROLE_KEY — no anon or authenticated-role access is used
-- or wanted anywhere in this app. Grants below are scoped to the exact
-- operations each table's code path actually performs (checked against
-- api/_lib/supabase.js, the only file that talks to the database):
--   bilang.splits         — createSplit (insert), getSplit (select),
--                            claimSplitItem (update). No deletes anywhere in
--                            the app. Not append-only.
--   bilang.bill_analytics — insertAnalyticsRows (insert) only. No select,
--                           update, or delete anywhere in the app — this
--                           table IS append-only in practice.
grant select, insert, update on bilang.splits to service_role;
grant insert on bilang.bill_analytics to service_role;

-- bill_analytics.id is a bigserial, which is backed by an implicit sequence
-- (bilang.bill_analytics_id_seq once the table lives in bilang). The service
-- role needs USAGE (to call nextval on insert) and SELECT (some clients read
-- back the generated id) on it. splits.id is a plain `text primary key` with
-- no sequence, so nothing is needed there.
grant usage, select on bilang.bill_analytics_id_seq to service_role;

-- Explicit revokes: a custom schema does not grant anon/authenticated
-- anything automatically, so these are a defence-in-depth statement of
-- intent, not a fix for something currently open. Safe to re-run.
revoke all on bilang.splits from anon, authenticated;
revoke all on bilang.bill_analytics from anon, authenticated;
revoke all on bilang.bill_analytics_id_seq from anon, authenticated;

-- Not implemented in this pass (MVP-3 scope, per roadmap §5):
--   - A scheduled cleanup job (Supabase Edge Function or pg_cron) that
--     archives-then-deletes `bilang.splits` rows past their `expires_at`.
--   - Retention-window tuning (7 vs 30 days is Open Question OQ-6, undecided).
--   - Usage reporting/aggregation queries against `bilang.bill_analytics`.
-- The `expires_at` column above exists now specifically so that future job
-- has something correct to act on from day one.

-- Rollback (manual — moves the tables back to `public`; run the reverse of
-- the move above, does not touch data, then optionally drop the now-empty
-- schema. This does NOT drop `bilang` while it still contains the tables —
-- `drop schema` on a non-empty schema fails unless `cascade` is used, and
-- `cascade` would drop the tables' data too, so it is deliberately left out
-- here):
--   alter table bilang.splits set schema public;
--   alter table bilang.bill_analytics set schema public;
--   revoke usage on schema bilang from service_role;
--   drop schema if exists bilang;  -- only after both tables above are moved out
