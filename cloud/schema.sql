-- Onward cloud schema (also auto-created on first boot by ensureSchema()).
CREATE TABLE IF NOT EXISTS users (
  id           BIGSERIAL PRIMARY KEY,
  username     TEXT UNIQUE NOT NULL,
  email        TEXT UNIQUE,
  pw_salt      TEXT NOT NULL,
  pw_hash      TEXT NOT NULL,
  sec_question TEXT,
  sec_salt     TEXT,
  sec_hash     TEXT,
  created_at   TIMESTAMPTZ DEFAULT now()
);

CREATE TABLE IF NOT EXISTS user_data (
  user_id    BIGINT PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
  data       JSONB NOT NULL,
  version    INTEGER NOT NULL DEFAULT 1,
  updated_at TIMESTAMPTZ DEFAULT now()
);
