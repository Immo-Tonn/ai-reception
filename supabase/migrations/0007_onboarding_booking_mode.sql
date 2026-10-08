-- ServiceOS — 0007: onboarding booking mode
--
-- Which of the three ways clients work with this business (appointments /
-- jobs / projects) was picked in onboarding. `workspaces.industry` already
-- exists (0001) and is reused as-is.
--
-- Idempotent. NOTE: the existing `ai-reception` project already has this
-- column (applied by hand earlier); re-running is a no-op.

alter table workspaces
  add column if not exists booking_mode text not null default 'appointments'
  check (booking_mode in ('appointments', 'jobs', 'projects'));
