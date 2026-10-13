-- ServiceOS — 0026: stable Google account binding for external calendar connections.
--
-- google_subject_hash = HMAC-SHA256 (server-side key, never in the DB) of the
-- Google OpenID Connect subject ("sub": a stable, never reused account id,
-- verified from a signed ID token). It lets a person find and disconnect ALL
-- their own connections on /connect-calendar/manage after signing in with
-- Google, and tells the server whether a Google grant is still used by another
-- connection (Google revokes the whole grant of an account at once).
-- Pseudonymised: the raw sub, e-mail or name are never stored.
--
-- Additive only: one nullable column + index. No existing row is changed
-- (connections made before this migration simply have NULL).
-- Same access model as 0025: service role only (no grants to anon/authenticated).

alter table public.external_calendar_connections
  add column if not exists google_subject_hash text;

do $$
begin
  if not exists (
    select 1 from pg_constraint where conname = 'external_calendar_subject_hash_format'
  ) then
    alter table public.external_calendar_connections
      add constraint external_calendar_subject_hash_format
      check (google_subject_hash is null or google_subject_hash ~ '^[0-9a-f]{64}$');
  end if;
end;
$$;

create index if not exists idx_external_calendar_connections_subject
  on public.external_calendar_connections (google_subject_hash)
  where google_subject_hash is not null;
