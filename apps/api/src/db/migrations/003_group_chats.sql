-- Optional N-participant chat threads.
--
-- The legacy 1:1 thread model (creator_user_id + brand_user_id columns on
-- chat_threads) stays in place for backwards compatibility. Group threads
-- are modelled by an additional row in chat_thread_participants for every
-- extra user beyond the original two. Callers should LEFT JOIN this table
-- when checking access for non-trivial threads.

CREATE TABLE IF NOT EXISTS chat_thread_participants (
  thread_id uuid NOT NULL REFERENCES chat_threads(id) ON DELETE CASCADE,
  user_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  role text NOT NULL CHECK (role IN ('creator', 'brand')),
  added_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (thread_id, user_id)
);

CREATE INDEX IF NOT EXISTS chat_thread_participants_user_id_idx
  ON chat_thread_participants(user_id);

-- A simple flag so the API can quickly tell single-pair from group threads.
ALTER TABLE chat_threads
  ADD COLUMN IF NOT EXISTS is_group boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS title text;
