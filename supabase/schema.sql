-- Bilang MVP-1 schema (Supabase / Postgres)
--
-- Two tables, deliberately kept separate:
--   1. splits          — operational data the app needs to function
--   2. bill_analytics   — genuinely anonymised, aggregate-only capture (roadmap F7a)
--
-- Manual setup step for Alex: paste this whole file into the Supabase
-- dashboard's SQL Editor (Project -> SQL Editor -> New query) and run it once,
-- after creating the Supabase project. Nothing in this repo runs migrations
-- automatically — this .sql file is the single source of truth for the schema
-- and is applied by hand.

create table if not exists splits (
  id                    text primary key,          -- short public id, e.g. "K7mP2xQaN" (see api/_lib/validate.js)
  items                 jsonb not null,             -- array of {id, name, category, qty, unit_price, line_total}
  assignments           jsonb not null,             -- { [itemId]: [payerName, ...] }
  totals                jsonb not null,              -- { subtotal, service_charge, tax, grand_total }
  owner_payment_handle  text not null,               -- DuitNow ID / bank account / QR string — display-only, never validated
  created_at            timestamptz not null default now(),
  expires_at            timestamptz not null          -- retention window; see RETENTION_DAYS in .env.example
);

-- Speeds up the future MVP-3 cleanup job's `WHERE expires_at < now()` sweep.
create index if not exists splits_expires_at_idx on splits (expires_at);

-- Anonymised, de-identified analytics dataset (roadmap F7a — MVP-1 scope,
-- capture only; reporting/aggregation against it is MVP-3 scope).
--
-- Deliberately minimal: item category, amount, timestamp — nothing else.
-- No name, no payment handle, and NO foreign key back to `splits.id`. This is
-- a genuine severance (true anonymisation), not mere pseudonymisation — see
-- Howard's technical assessment §5 amendment and the roadmap's E1/F7
-- discussion for why that distinction is load-bearing, not cosmetic. Do not
-- add a split_id column to this table.
create table if not exists bill_analytics (
  id             bigserial primary key,
  item_category  text not null check (item_category in ('food', 'drink', 'tax', 'service', 'other')),
  amount         numeric not null,
  created_at     timestamptz not null default now()
);

-- Not implemented in this pass (MVP-3 scope, per roadmap §5):
--   - A scheduled cleanup job (Supabase Edge Function or pg_cron) that
--     archives-then-deletes `splits` rows past their `expires_at`.
--   - Retention-window tuning (7 vs 30 days is Open Question OQ-6, undecided).
--   - Usage reporting/aggregation queries against `bill_analytics`.
-- The `expires_at` column above exists now specifically so that future job
-- has something correct to act on from day one.
