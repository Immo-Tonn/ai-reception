-- ServiceOS — 0007: onboarding booking mode
--
-- Run this once in the Frankfurt project's SQL Editor. Adds the one
-- column the onboarding wizard needs that didn't already exist: which of
-- the three ways clients work with this business (appointments / jobs /
-- projects) was picked in onboarding step 2. `workspaces.industry`
-- already existed and is reused as-is for step 1's choice.
--
-- Same file also lives in the repo at
-- supabase/migrations/0007_onboarding_booking_mode.sql for the record.

alter table workspaces
  add column if not exists booking_mode text not null default 'appointments'
  check (booking_mode in ('appointments', 'jobs', 'projects'));
