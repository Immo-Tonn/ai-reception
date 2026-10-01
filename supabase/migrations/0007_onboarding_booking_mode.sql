-- ServiceOS — 0007: onboarding booking mode
--
-- Adds the one column the onboarding wizard needs that didn't already
-- exist: which of the three ways clients work with this business
-- (appointments / jobs / projects) was picked in onboarding step 2.
-- `workspaces.industry` already existed (0001) and is reused as-is.

alter table workspaces
  add column if not exists booking_mode text not null default 'appointments'
  check (booking_mode in ('appointments', 'jobs', 'projects'));
