-- One-time fix: convert due_date / start_date from "Central wall-clock stored
-- as UTC" to genuine UTC instants.
--
-- BACKGROUND
--   The old UI wrote naive wall-clock strings (e.g. "2026-07-30T23:59:00") which
--   Postgres stored verbatim as 23:59:00+00 — i.e. the intended *Central* time was
--   recorded with a UTC offset. The new app reads/writes true UTC and renders in
--   the user's zone, so these legacy values must be re-anchored to real UTC.
--
-- TRANSFORM
--   (col AT TIME ZONE 'UTC')          -> the naive wall-clock that was stored
--   (...) AT TIME ZONE 'America/Chicago' -> reinterpret that wall-clock as Central,
--                                           yielding the correct UTC instant.
--   This is DST-correct per row (CDT -5 in summer, CST -6 in winter).
--
-- ORDERING (IMPORTANT)
--   Run this BEFORE the timezone-aware app code goes live. Every existing row is
--   in the legacy Central-as-UTC convention; rows written by the new code are
--   already true UTC and must NOT pass through this shift. Migrate, then deploy.

update journal_blocks
set due_date = (due_date at time zone 'UTC') at time zone 'America/Chicago'
where due_date is not null;

update journal_blocks
set start_date = (start_date at time zone 'UTC') at time zone 'America/Chicago'
where start_date is not null;
