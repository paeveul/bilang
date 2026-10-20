-- Bilang MVP-1 schema (Supabase / Postgres)
--
-- Four tables (the account tables are added further down):
--   1. bilang.splits            - operational data the app needs to function
--   2. bilang.bill_analytics    - genuinely anonymised, aggregate-only capture
--   3. bilang.accounts          - signed-in account ids
--   4. bilang.terms_acceptances - append-only terms acceptance record
-- Tables that can be edited (splits, accounts) carry a database-maintained
-- updated_at column; the insert-only tables (bill_analytics, terms_acceptances)
-- deliberately do not.
--
-- All tables live under a dedicated `bilang` schema, not `public`, for more
-- scrutiny over database access. This file MOVES the tables rather than
-- dropping and recreating them: `alter table ... set schema` preserves every
-- existing row and column definition, and the table no longer exists under
-- `public` afterwards, so nothing is left behind in the old location. This is
-- deliberately safer than a drop-and-recreate, which would destroy any rows
-- already stored.
--
-- Manual setup step: paste this whole file into the Supabase dashboard's SQL
-- Editor (Project -> SQL Editor -> New query) and run it once. Nothing in this
-- repo runs migrations automatically; this .sql file is the single source of
-- truth for the schema and is applied by hand.
--
-- >>> RUN THIS IN EVERY DATABASE <<<
-- This file must be applied to every database the app uses (the test database,
-- and later the production database) before the payer item-claiming feature
-- ships there. Re-running it is safe either way: every statement below is
-- idempotent (see the per-step notes).
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

-- Shared trigger function for every table that has an `updated_at` column.
-- Each such table attaches a BEFORE UPDATE trigger that calls this, so the
-- database stamps the "last changed" time itself, even if a write tries to
-- supply a different value. It must exist before any table's trigger is
-- created. Insert-only tables (bill_analytics, terms_acceptances) have no
-- updated_at and no trigger. Never use updated_at as a retention anchor or
-- as a financial-event date; those use their own dedicated columns.
-- Idempotent (create or replace).
create or replace function bilang.set_updated_at()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  new.updated_at := now();
  return new;
end;
$$;

revoke all on function bilang.set_updated_at() from public, anon, authenticated;

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

-- Payer item-claiming: additive columns on `bilang.splits`.
-- Idempotent: safe to re-run, and safe on a database that already holds rows
-- (existing splits get payers = NULL and version = 0; nothing is backfilled,
-- splits expire in RETENTION_DAYS anyway). Apply by hand like the rest of this
-- file. Nothing in the app reads or writes these columns until the claiming
-- code lands, so applying this early breaks nothing. Targets `bilang.splits`
-- (not `public.splits`) because by the time anyone runs this file the table
-- has already moved to `bilang` by the block above.
--   payers  - ordered roster of payer names (jsonb array of strings). NULL on
--             splits created before this column existed; those cannot be
--             claimed against.
--   version - compare-and-swap counter, bumped by every successful claim write.
alter table bilang.splits add column if not exists payers  jsonb;
alter table bilang.splits add column if not exists version integer not null default 0;
--
-- Rollback (manual; destroys the stored rosters / counters, so only before
-- claiming ships or if the data is disposable):
--   alter table bilang.splits drop column if exists version;
--   alter table bilang.splits drop column if exists payers;

-- Merchant name and receipt date: additive columns on `bilang.splits`. Same
-- idempotent pattern as the payers/version columns above: safe to re-run, safe
-- on a database that already holds rows (existing splits get both columns
-- NULL, nothing backfilled). No index on either: neither is ever queried or
-- filtered on. Targets `bilang.splits`, not `public.splits`, for the same
-- reason as the block above: by the time anyone runs this file the table has
-- already moved to `bilang`.
--   merchant_name - restaurant/merchant name exactly as printed, if legible.
--   receipt_date  - receipt date, if legible.
alter table bilang.splits add column if not exists merchant_name text;
alter table bilang.splits add column if not exists receipt_date date;
--
-- Rollback (manual; destroys any stored merchant name / receipt date, so
-- only before this item ships or if the data is disposable):
--   alter table bilang.splits drop column if exists receipt_date;
--   alter table bilang.splits drop column if exists merchant_name;

-- `splits.updated_at` — database-maintained "last changed" time. Set by the
-- shared bilang.set_updated_at() trigger on every UPDATE of the row (for
-- example each payer claim); the app never writes it. Rows that existed when
-- this column was added show the time the statement ran, not their true
-- last-change time. Not selected by any app query, so it is never returned
-- to the anonymous payer view. Idempotent.
alter table bilang.splits add column if not exists updated_at timestamptz not null default now();

drop trigger if exists splits_set_updated_at on bilang.splits;
create trigger splits_set_updated_at
  before update on bilang.splits
  for each row execute function bilang.set_updated_at();

-- Speeds up the future MVP-3 cleanup job's `WHERE expires_at < now()` sweep.
create index if not exists splits_expires_at_idx on bilang.splits (expires_at);

-- Anonymised, de-identified analytics dataset (capture only; reporting and
-- aggregation against it come later).
--
-- Deliberately minimal: item category, amount, timestamp, nothing else. No
-- name, no payment handle, and NO foreign key back to `splits.id`. This is a
-- genuine severance (true anonymisation), not mere pseudonymisation, and that
-- distinction is load-bearing, not cosmetic. Do not add a split_id column to
-- this table.
--
-- Deliberately no updated_at column: rows are insert-only and never edited,
-- so it would always equal created_at, and it would add a second exact
-- timestamp to a table that is meant to stay anonymous.
create table if not exists bilang.bill_analytics (
  id             bigserial primary key,
  item_category  text not null check (item_category in ('food', 'drink', 'tax', 'service', 'other')),
  amount         numeric not null,
  created_at     timestamptz not null default now()
);

-- Row Level Security. Same posture used by every other Bilang table: RLS
-- enabled, no policies, denying every row to every role by default. `splits`
-- and `bill_analytics` predate that pattern being established and were the two
-- tables missing it.
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

-- Grants. A custom schema gets NO automatic grants (unlike a first-party table
-- under `public`, which Supabase seeds with default privileges today). Bilang's
-- server (see api/_lib/supabase.js) is the only caller and it uses exclusively
-- the SUPABASE_SERVICE_ROLE_KEY: no anon or authenticated-role access is used
-- or wanted anywhere in this app. Grants below are scoped to the exact
-- operations each table's code path actually performs (checked against
-- api/_lib/supabase.js, the only file that talks to the database):
--   bilang.splits         - createSplit (insert), getSplit (select),
--                           claimSplitItem (update). No deletes anywhere in
--                           the app. Not append-only.
--   bilang.bill_analytics - insertAnalyticsRows (insert) only. No select,
--                           update, or delete anywhere in the app; this
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

-- Not implemented here (later scope):
--   - A scheduled cleanup job (Supabase Edge Function or pg_cron) that
--     archives-then-deletes `bilang.splits` rows past their `expires_at`.
--   - Retention-window tuning (7 vs 30 days is undecided).
--   - Usage reporting/aggregation queries against `bilang.bill_analytics`.
-- The `expires_at` column above exists now specifically so that future job has
-- something correct to act on from day one.

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

-- =============================================================================
-- Account and email OTP sign-in tables.
-- Same posture as every table above: dedicated `bilang` schema, RLS enabled
-- with NO policies (deny-by-default; the service-role key inside
-- api/_lib/auth.js and api/_lib/supabase.js is the only caller and bypasses RLS
-- entirely), explicit grants scoped to exactly what this feature's code path
-- performs, explicit revokes from anon/authenticated as defence in depth.
-- Manual application only: run by hand in the Supabase SQL editor, same as
-- every other block in this file.
-- =============================================================================

-- `accounts`: keyed by the Supabase auth user id (accounts.id), but
-- deliberately NOT foreign-keyed to `auth.users`. Every Bilang table references
-- `accounts`, never `auth.users`, so a future auth-provider change never has to
-- touch application schema. No email or other PII column here: the verified
-- email lives only in Supabase's own `auth.users`.
create table if not exists bilang.accounts (
  id          uuid primary key,
  created_at  timestamptz not null default now()
);

-- `splits.account_id`: nullable at the database level because rows predating
-- this column exist; required at the application layer instead (POST
-- /api/split refuses without a session). Not a foreign key target for any
-- SELECT the app performs today: the existing GET /api/split column list in
-- api/_lib/supabase.js (SPLIT_COLUMNS) is untouched by this file and must stay
-- untouched when createSplit starts threading accountId through: adding
-- account_id to that SELECT list would leak the creator's account id to the
-- anonymous payer view.
alter table bilang.splits add column if not exists account_id uuid references bilang.accounts (id);
create index if not exists splits_account_id_idx on bilang.splits (account_id);

alter table bilang.accounts enable row level security;

-- `accounts.terms_version_seen`: GET /api/auth/session silently writes the
-- currently published VITE_TERMS_VERSION here whenever it differs from what is
-- already stored, on every signed-in session load, not just for new accounts.
-- No banner, no email, no copy change is triggered by this column; a visible
-- notification mechanism is a later item. Nullable: pre-existing accounts, and
-- a brand-new account before its first post-signup session load, start with no
-- seen version.
alter table bilang.accounts add column if not exists terms_version_seen text;

-- `accounts.updated_at` — database-maintained "last changed" time. Set by the
-- shared bilang.set_updated_at() trigger on every UPDATE of the row; the app
-- never writes it. Rows that existed when this column was added show the time
-- the statement ran, not their true last-change time. Idempotent.
alter table bilang.accounts add column if not exists updated_at timestamptz not null default now();

drop trigger if exists accounts_set_updated_at on bilang.accounts;
create trigger accounts_set_updated_at
  before update on bilang.accounts
  for each row execute function bilang.set_updated_at();

-- `terms_acceptances`: the timestamped, versioned acceptance record. Append-only
-- in practice (no UPDATE or DELETE anywhere in this build, same spirit as
-- bilang.bill_analytics above): a record that cannot be altered after the fact
-- is the whole point, since it is evidence for a dispute raised months later.
-- `terms_kind` is constrained to 'signup' only for now; a checkout-step
-- acceptance will add its own value (e.g. 'credits_purchase') when that is
-- built; this file does not pre-invent that value. `terms_version` is plain
-- text, not a foreign key: the terms feature owns the actual version string
-- and its versioning scheme; this table just records whichever string was
-- current at the moment of acceptance.
--
-- Deliberately no updated_at column: rows are insert-only and never edited,
-- so a "last changed" time would always equal accepted_at and would suggest
-- the record can change. accepted_at is the only timestamp this table needs.
create table if not exists bilang.terms_acceptances (
  id            bigserial primary key,
  account_id    uuid not null references bilang.accounts (id),
  terms_kind    text not null check (terms_kind in ('signup')),
  terms_version text not null,
  accepted_at   timestamptz not null default now()
);

create index if not exists terms_acceptances_account_id_idx
  on bilang.terms_acceptances (account_id);

alter table bilang.terms_acceptances enable row level security;

-- Grants: same rationale as the splits/bill_analytics grants above. A custom
-- schema gets no automatic grants, and Bilang's server (api/_lib/auth.js and
-- api/_lib/supabase.js) uses exclusively the service_role key. Scoped to exactly
-- what this feature's code path performs:
--   bilang.accounts          - upsert on successful OTP verification
--                              (select, insert, update). No delete anywhere in
--                              this build.
--   bilang.terms_acceptances - insert only, on first-time account creation. No
--                              select, update, or delete anywhere in this
--                              build; this table IS append-only in practice,
--                              same as bill_analytics.
grant select, insert, update on bilang.accounts to service_role;
grant insert on bilang.terms_acceptances to service_role;

-- terms_acceptances.id is a bigserial, backed by an implicit sequence
-- (bilang.terms_acceptances_id_seq). service_role needs USAGE (nextval on
-- insert) and SELECT (some clients read back the generated id) on it, same
-- pattern as bilang.bill_analytics_id_seq above. accounts.id is a plain
-- `uuid primary key` supplied by the caller (the Supabase auth user id), not
-- a sequence, so nothing is needed there.
grant usage, select on bilang.terms_acceptances_id_seq to service_role;

revoke all on bilang.accounts from anon, authenticated;
revoke all on bilang.terms_acceptances from anon, authenticated;
revoke all on bilang.terms_acceptances_id_seq from anon, authenticated;

-- Rollback (manual — drops both new tables and the splits.account_id
-- column; only before this item ships or if the data is disposable. Order
-- matters: terms_acceptances and splits.account_id both reference accounts,
-- so they must be dropped before accounts):
--   drop index if exists bilang.terms_acceptances_account_id_idx;
--   drop table if exists bilang.terms_acceptances;
--   drop index if exists bilang.splits_account_id_idx;
--   alter table bilang.splits drop column if exists account_id;
--   alter table bilang.accounts drop column if exists terms_version_seen;
--   drop table if exists bilang.accounts;

-- Rollback for the updated_at columns and triggers (manual; safe because no
-- application code reads the column). Run before any of the rollbacks above
-- that drop a table, or independently of them:
--   drop trigger if exists accounts_set_updated_at on bilang.accounts;
--   alter table bilang.accounts drop column if exists updated_at;
--   drop trigger if exists splits_set_updated_at on bilang.splits;
--   alter table bilang.splits drop column if exists updated_at;
--   drop function if exists bilang.set_updated_at();
