-- Re-anchor date-only due/start sentinels to UTC-literal storage.
--
-- BACKGROUND
--   The previous timezone migration (20260525000001) shifted every due/start
--   value by the Central offset to make wall-clock times into true UTC. That
--   was correct for date+time values, but it also moved the "no time set"
--   sentinel — 23:59:59 (due) / 00:00:00 (start) — out of UTC. As a result,
--   the sentinel only round-trips for viewers in America/Chicago; anyone
--   viewing in another zone sees a stray time because the wall-clock no
--   longer matches 23:59:59 / 00:00:00.
--
-- FIX
--   Date-only entries should be timezone-agnostic — "May 27" is May 27 in
--   every zone. Store them as a fixed UTC instant (YYYY-MM-DDT23:59:59Z or
--   T00:00:00Z) and detect them by UTC components, not wall-clock.
--
-- DETECTION
--   Any row whose Central wall-clock is exactly 23:59:59 (due) or 00:00:00
--   (start) is a date-only sentinel. The picker is HH:MM-granular, so a real
--   23:59 entry has :00 seconds and won't be caught. Real midnight starts
--   collide with the start sentinel — pre-existing ambiguity, unchanged.
--
-- ORDERING
--   Run BEFORE deploying the new client code. The new client writes UTC-
--   literal sentinels going forward; this migration brings legacy rows
--   onto the same convention.

-- Due-date sentinel → UTC literal 23:59:59
update journal_blocks
set due_date = (
  (due_date at time zone 'America/Chicago')::date::text || ' 23:59:59'
)::timestamp at time zone 'UTC'
where due_date is not null
  and to_char(due_date at time zone 'America/Chicago', 'HH24:MI:SS') = '23:59:59';

-- Start-date sentinel → UTC literal 00:00:00
update journal_blocks
set start_date = (
  (start_date at time zone 'America/Chicago')::date::text || ' 00:00:00'
)::timestamp at time zone 'UTC'
where start_date is not null
  and to_char(start_date at time zone 'America/Chicago', 'HH24:MI:SS') = '00:00:00';
