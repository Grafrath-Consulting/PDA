-- Catch the date-only due-date entries that 20260527000000 missed.
--
-- BACKGROUND
--   The previous migration only matched rows whose Central wall-clock was
--   exactly 23:59:59. That covers UI-created sentinels (the picker writes
--   ":59" seconds), but 44 MCP-created tasks landed with `T23:59:00` because
--   the AI client's "end of day" timestamps zero out the seconds field.
--
--   Both forms semantically mean "no time set" — the 30-min UI picker can't
--   even produce a 23:59 selection, and a real "due at 23:59 sharp" reminder
--   is not something users actually create. Treat any HH=23 AND MM=59 Central
--   wall-clock as the date-only sentinel and rewrite it to the UTC-literal
--   form so detection works in every viewer's zone.

update journal_blocks
set due_date = (
  (due_date at time zone 'America/Chicago')::date::text || ' 23:59:59'
)::timestamp at time zone 'UTC'
where due_date is not null
  and extract(hour from due_date at time zone 'America/Chicago') = 23
  and extract(minute from due_date at time zone 'America/Chicago') = 59
  and to_char(due_date, 'HH24:MI:SS') <> '23:59:59';
