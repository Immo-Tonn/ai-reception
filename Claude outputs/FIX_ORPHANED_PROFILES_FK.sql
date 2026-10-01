-- ============================================================================
-- Fix: prevent orphaned `profiles` rows when an auth.users row disappears
-- ============================================================================
-- Symptom this fixes: "duplicate key value violates unique constraint
-- profiles_email_key" on signup, caused by a `profiles` row that outlived
-- its matching `auth.users` row (the user was deleted from Supabase Auth
-- through some other path — dashboard, API, manual SQL — but the profile
-- stayed behind).
--
-- This adds a foreign key from profiles.id -> auth.users.id with
-- ON DELETE CASCADE, so that from now on, deleting an auth user
-- automatically deletes their profile (and, via the existing FK from
-- workspace_members.profile_id -> profiles.id, their workspace_members
-- rows too) instead of leaving orphans.
--
-- NOT VALID is used so this does NOT fail because of the currently existing
-- orphaned row (profiles id fffacfa5-161f-4f9b-9e5a-86f6e8912b62). The
-- constraint is still fully enforced for every future insert/update/delete
-- from the moment it's created — NOT VALID only skips the one-time scan of
-- existing rows. The existing orphan itself is not touched by this
-- statement; it will keep violating the constraint until it is dealt with
-- separately (see the two options below).
-- ============================================================================

alter table public.profiles
  add constraint profiles_id_fkey
  foreign key (id) references auth.users (id)
  on delete cascade
  not valid;

-- Optional, run later once the current orphan is resolved (see below):
-- this makes Postgres actually re-check all existing rows and mark the
-- constraint as fully valid/trusted. It is NOT required for the constraint
-- to work going forward — only for it to stop being reported as "not
-- validated" in tooling/introspection. Running it now would fail because
-- of the current orphaned row.
-- alter table public.profiles validate constraint profiles_id_fkey;
