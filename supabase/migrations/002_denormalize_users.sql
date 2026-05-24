-- Drop tables in reverse dependency order
drop table if exists settlements          cascade;
drop table if exists expense_participants cascade;
drop table if exists expenses             cascade;
drop table if exists trip_users           cascade;
drop table if exists users                cascade;

-- Drop types
drop type if exists settlement_status cascade;
drop type if exists expense_status    cascade;
drop type if exists settlement_type   cascade;
drop type if exists trip_role         cascade;

-- ─── TYPES ────────────────────────────────────────────────────────────────────
create type trip_role         as enum ('admin', 'member');
create type settlement_type   as enum ('immediate', 'deferred');
create type expense_status    as enum ('draft', 'confirmed');
create type settlement_status as enum ('pending', 'paid');

-- ─── TRIP MEMBERS (identity lives here, no global users table) ────────────────
create table trip_users (
  id           uuid primary key default gen_random_uuid(),
  trip_id      uuid not null references trips(id) on delete cascade,
  name         text not null,
  payment_ref  text,          -- Bre-B / Nequi / Cuenta — copiable en la UI
  role         trip_role not null default 'member',
  joined_at    timestamptz not null default now()
);

-- ─── EXPENSES ─────────────────────────────────────────────────────────────────
create table expenses (
  id               uuid primary key default gen_random_uuid(),
  trip_id          uuid not null references trips(id)      on delete cascade,
  description      text not null default '',
  amount_total     numeric(14, 2) not null check (amount_total > 0),
  currency         text not null,
  paid_by          uuid not null references trip_users(id) on delete restrict,
  settlement_type  settlement_type not null default 'deferred',
  category         text not null default 'general',
  image_url        text,
  status           expense_status not null default 'confirmed',
  created_at       timestamptz not null default now()
);

-- ─── EXPENSE PARTICIPANTS ─────────────────────────────────────────────────────
create table expense_participants (
  id          uuid primary key default gen_random_uuid(),
  expense_id  uuid not null references expenses(id)   on delete cascade,
  user_id     uuid not null references trip_users(id) on delete cascade,
  weight      numeric(8, 4) not null default 1.0 check (weight > 0),
  unique (expense_id, user_id)
);

-- ─── SETTLEMENTS ──────────────────────────────────────────────────────────────
create table settlements (
  id          uuid primary key default gen_random_uuid(),
  trip_id     uuid not null references trips(id)      on delete cascade,
  from_user   uuid not null references trip_users(id) on delete restrict,
  to_user     uuid not null references trip_users(id) on delete restrict,
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

-- ─── RLS ──────────────────────────────────────────────────────────────────────
alter table trip_users           enable row level security;
alter table expenses             enable row level security;
alter table expense_participants enable row level security;
alter table settlements          enable row level security;
