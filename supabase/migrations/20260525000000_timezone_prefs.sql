-- Add timezone preferences to profiles.
--   timezone: IANA zone name (e.g. 'America/Chicago') used to render and
--             interpret due/start dates and all timestamps.
--   timezone_auto_detect: when true, the app adopts the browser's detected
--                         zone on load and persists it here.
-- Default 'America/Chicago' matches the existing data, which was entered as
-- US Central wall-clock time (see the companion data migration).
alter table profiles
  add column timezone text not null default 'America/Chicago',
  add column timezone_auto_detect boolean not null default true;
