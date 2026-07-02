-- sql/144_townhall_response_counter_increment.sql
-- Atomic increment for townhall_sessions.response_counter.
--
-- The chat route did a read-modify-write (read response_counter, +1, write back).
-- A live town hall is the app's highest-concurrency scenario — many participants
-- answering the same prompt within the same second — so concurrent submits read
-- the same value and overwrite each other, undercounting responses (and skewing
-- the "every N responses" auto theme-detection trigger, which keys off the
-- returned counter). This does the +1 in a single UPDATE and RETURNS the new
-- value so the caller still gets an accurate, race-free count.
--
-- Additive: creating the function is inert until the chat route calls it.

BEGIN;

CREATE OR REPLACE FUNCTION increment_townhall_response_counter(p_session_id uuid)
RETURNS integer
LANGUAGE sql
AS $$
  UPDATE townhall_sessions
  SET response_counter = COALESCE(response_counter, 0) + 1
  WHERE id = p_session_id
  RETURNING response_counter;
$$;

COMMENT ON FUNCTION increment_townhall_response_counter(uuid) IS
  'Atomically increments townhall_sessions.response_counter and returns the new value. Replaces a racy read-modify-write in the town-hall chat route.';

COMMIT;
