-- WhatsApp bot integration

-- Link a WhatsApp phone number to a trip member
ALTER TABLE trip_users
  ADD COLUMN IF NOT EXISTS phone text;

-- One phone per trip (the same person can be in multiple trips)
CREATE UNIQUE INDEX IF NOT EXISTS trip_users_trip_phone_key
  ON trip_users (trip_id, phone) WHERE phone IS NOT NULL;

-- Conversation session per phone number (one active "context" at a time)
CREATE TABLE IF NOT EXISTS whatsapp_sessions (
  phone       text        PRIMARY KEY,
  trip_id     uuid        REFERENCES trips(id)      ON DELETE SET NULL,
  member_id   uuid        REFERENCES trip_users(id) ON DELETE SET NULL,
  step        text        NOT NULL DEFAULT 'idle',
  context     jsonb       NOT NULL DEFAULT '{}',
  updated_at  timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE whatsapp_sessions ENABLE ROW LEVEL SECURITY;
