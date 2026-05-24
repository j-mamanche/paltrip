-- Add multi-currency support to expenses.
-- amount_total stays as the original amount in the expense's currency.
-- amount_base is the amount converted to the trip's base currency using the
-- exchange rate at the time of expense creation. The balance engine uses amount_base.

ALTER TABLE expenses
  ADD COLUMN IF NOT EXISTS original_currency text,
  ADD COLUMN IF NOT EXISTS original_amount   numeric(14, 2),
  ADD COLUMN IF NOT EXISTS exchange_rate     numeric(16, 6) NOT NULL DEFAULT 1.0,
  ADD COLUMN IF NOT EXISTS amount_base       numeric(14, 2);

-- Backfill existing rows: treat them as same-currency (rate = 1)
UPDATE expenses
SET
  original_currency = currency,
  original_amount   = amount_total,
  amount_base       = amount_total
WHERE amount_base IS NULL;

ALTER TABLE expenses ALTER COLUMN amount_base SET NOT NULL;

CREATE INDEX IF NOT EXISTS expenses_trip_currency ON expenses (trip_id, currency);
