-- Expense line-item detail for itemized splits

CREATE TABLE expense_items (
  id          uuid primary key default gen_random_uuid(),
  expense_id  uuid not null references expenses(id) on delete cascade,
  description text not null default '',
  quantity    integer not null default 1 check (quantity > 0),
  unit_price  numeric(14, 2) not null default 0 check (unit_price >= 0),
  amount      numeric(14, 2) not null default 0 check (amount >= 0),
  created_at  timestamptz not null default now()
);

CREATE TABLE expense_item_assignments (
  id      uuid primary key default gen_random_uuid(),
  item_id uuid not null references expense_items(id) on delete cascade,
  user_id uuid not null references trip_users(id) on delete cascade,
  unique (item_id, user_id)
);

CREATE INDEX ON expense_items (expense_id);
CREATE INDEX ON expense_item_assignments (item_id);

ALTER TABLE expenses
  ADD COLUMN IF NOT EXISTS split_mode text NOT NULL DEFAULT 'equal',
  ADD COLUMN IF NOT EXISTS tip_amount numeric(14, 2) NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS tip_mode   text NOT NULL DEFAULT 'proportional';

ALTER TABLE trips
  ADD COLUMN IF NOT EXISTS status text NOT NULL DEFAULT 'active';

ALTER TABLE expense_items        ENABLE ROW LEVEL SECURITY;
ALTER TABLE expense_item_assignments ENABLE ROW LEVEL SECURITY;
