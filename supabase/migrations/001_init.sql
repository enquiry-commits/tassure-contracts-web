-- Table 1: contracts (main record)
CREATE TABLE IF NOT EXISTS contracts (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  reference_id TEXT NOT NULL UNIQUE,
  client_name TEXT NOT NULL,
  pic TEXT NOT NULL,
  remarks TEXT,
  file_path TEXT NOT NULL,
  file_url TEXT NOT NULL,
  is_delivered BOOLEAN DEFAULT FALSE,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

-- Table 2: daily_sequence (per-day counter)
CREATE TABLE IF NOT EXISTS daily_sequence (
  date DATE PRIMARY KEY,
  last_seq INTEGER NOT NULL DEFAULT 0
);

-- Table 3: pic_list (staff responsible)
CREATE TABLE IF NOT EXISTS pic_list (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  name TEXT NOT NULL,
  is_active BOOLEAN DEFAULT TRUE
);

-- Atomic sequence function (prevents race conditions on concurrent calls)
CREATE OR REPLACE FUNCTION get_next_sequence(today DATE)
RETURNS INTEGER AS $$
DECLARE
  next_seq INTEGER;
BEGIN
  INSERT INTO daily_sequence (date, last_seq)
  VALUES (today, 1)
  ON CONFLICT (date) DO UPDATE
    SET last_seq = daily_sequence.last_seq + 1
  RETURNING last_seq INTO next_seq;
  RETURN next_seq;
END;
$$ LANGUAGE plpgsql;

-- RLS: disable for internal system (all access via service_role key)
ALTER TABLE contracts DISABLE ROW LEVEL SECURITY;
ALTER TABLE daily_sequence DISABLE ROW LEVEL SECURITY;
ALTER TABLE pic_list DISABLE ROW LEVEL SECURITY;

-- Seed some initial PIC names (edit as needed)
INSERT INTO pic_list (name) VALUES
  ('Vincent'),
  ('Admin')
ON CONFLICT DO NOTHING;
