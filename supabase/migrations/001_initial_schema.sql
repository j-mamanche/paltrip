-- Enable UUID extension
create extension if not exists "pgcrypto";

-- ─── TRIPS ────────────────────────────────────────────────────────────────────
create table trips (
  id            uuid primary key default gen_random_uuid(),
  name          text not null,
  currency      text not null default 'COP',
  access_token  text not null unique default encode(gen_random_bytes(12), 'hex'),
  created_at    timestamptz not null default now()
);

-- ─── USERS ────────────────────────────────────────────────────────────────────
create table users (
  id            uuid primary key default gen_random_uuid(),
  phone_number  text unique,
  name          text not null,
  created_at    timestamptz not null default now()
);

-- ─── TRIP MEMBERS ─────────────────────────────────────────────────────────────
create type trip_role as enum ('admin', 'member');

create table trip_users (
  id         uuid primary key default gen_random_uuid(),
  trip_id    uuid not null references trips(id) on delete cascade,
  user_id    uuid not null references users(id) on delete cascade,
  role       trip_role not null default 'member',
  joined_at  timestamptz not null default now(),
  unique (trip_id, user_id)
);

-- ─── EXPENSES ─────────────────────────────────────────────────────────────────
create type settlement_type as enum ('immediate', 'deferred');
create type expense_status  as enum ('draft', 'confirmed');

create table expenses (
  id               uuid primary key default gen_random_uuid(),
  trip_id          uuid not null references trips(id) on delete cascade,
  description      text not null default '',
  amount_total     numeric(14, 2) not null check (amount_total > 0),
  currency         text not null,
  paid_by          uuid not null references users(id),
  settlement_type  settlement_type not null default 'deferred',
  category         text not null default 'general',
  image_url        text,
  status           expense_status not null default 'confirmed',
  created_at       timestamptz not null default now()
);

-- ─── EXPENSE PARTICIPANTS ─────────────────────────────────────────────────────
create table expense_participants (
  id          uuid primary key default gen_random_uuid(),
  expense_id  uuid not null references expenses(id) on delete cascade,
  user_id     uuid not null references users(id) on delete cascade,
  weight      numeric(8, 4) not null default 1.0 check (weight > 0),
  unique (expense_id, user_id)
);

-- ─── SETTLEMENTS ──────────────────────────────────────────────────────────────
create type settlement_status as enum ('pending', 'paid');

create table settlements (
  id          uuid primary key default gen_random_uuid(),
  trip_id     uuid not null references trips(id) on delete cascade,
  from_user   uuid not null references users(id),
  to_user     uuid not null references users(id),
  amount      numeric(14, 2) not null check (amount > 0),
  status      settlement_status not null default 'pending',
  created_at  timestamptz not null default now(),
  check (from_user <> to_user)
);

-- ─── INDEXES ──────────────────────────────────────────────────────────────────
create index on trip_users (trip_id);
create index on expenses (trip_id);
create index on expense_participants (expense_id);
create index on settlements (trip_id);

-- ─── ROW LEVEL SECURITY ───────────────────────────────────────────────────────
alter table trips                enable row level security;
alter table users                enable row level security;
alter table trip_users           enable row level security;
alter table expenses             enable row level security;
alter table expense_participants enable row level security;
alter table settlements          enable row level security;

-- Service role bypasses RLS — app uses service role key on the server.
-- Add per-user policies here when auth is introduced.
