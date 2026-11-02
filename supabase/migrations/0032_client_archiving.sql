-- ServiceOS — 0032: archive / restore a client (reversible, NOT an erasure).
--
-- Numbering: 0028–0031 (GDPR stages 1–4) are separate, not yet merged changes;
-- apply them first (0028 -> 0029 -> 0030 -> 0031 -> 0032).
--
-- 1. clients.archived_at timestamptz NULL: NULL = active, a timestamp = archived.
--    Archiving changes nothing else: no appointment, invoice, note or link is
--    touched; future appointments are NOT cancelled.
-- 2. Permission clients.archive — owner and admin. clients UPDATE is allowed by
--    RLS with clients.edit (owner, admin, manager), so a trigger refuses a change of
--    archived_at by anyone without clients.archive (also a direct API call).
--    The service role (no auth.uid()) is not restricted.
-- 3. An anonymised client (0028, clients.anonymized_at) can be archived but never
--    restored to the active list. The marker is read via to_jsonb(), so this
--    migration works with and without 0028.
-- 4. A business user cannot create a NEW appointment or waiting-list entry for an
--    archived client (restore it first; error client_archived, shown only for a
--    client of the caller's own workspace to a member who may view clients). The
--    public booking / client-account functions run as the service role and keep
--    working: a returning customer can
--    still book; the client stays archived (no hidden status change).
--
-- Additive: one column, one index, one permission row, triggers. No row is changed.

alter table public.clients
  add column if not exists archived_at timestamptz;

create index if not exists idx_clients_workspace_active
  on public.clients (workspace_id) where archived_at is null;

insert into public.role_permissions (role, permission) values
  ('owner', 'clients.archive'), ('admin', 'clients.archive')
on conflict do nothing;

create or replace function public.guard_client_archive()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if new.archived_at is distinct from old.archived_at then
    if (select auth.uid()) is not null
       and not public.has_workspace_permission(new.workspace_id, 'clients.archive') then
      raise exception 'client_archive_not_permitted' using errcode = '42501';
    end if;
    if new.archived_at is null and (to_jsonb(old)->>'anonymized_at') is not null then
      raise exception 'client_anonymized' using errcode = '23514';
    end if;
  end if;
  return new;
end;
$$;
drop trigger if exists clients_guard_archive on public.clients;
create trigger clients_guard_archive
  before update of archived_at on public.clients
  for each row execute function public.guard_client_archive();
revoke all on function public.guard_client_archive() from public, anon, authenticated;

create or replace function public.guard_no_archived_client_ref()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  -- Only for a client of the SAME workspace and a caller who may view clients:
  -- anything else falls through to the existing checks (cross_workspace_reference,
  -- RLS), so the archive status of a client is never revealed to someone else.
  if new.client_id is not null
     and (select auth.uid()) is not null
     and (tg_op = 'INSERT' or new.client_id is distinct from old.client_id)
     and public.has_workspace_permission(new.workspace_id, 'clients.view')
     and exists (select 1 from public.clients c
                  where c.id = new.client_id and c.workspace_id = new.workspace_id and c.archived_at is not null) then
    raise exception 'client_archived' using errcode = '23514';
  end if;
  return new;
end;
$$;
drop trigger if exists appointments_guard_archived_client on public.appointments;
create trigger appointments_guard_archived_client
  before insert or update of client_id on public.appointments
  for each row execute function public.guard_no_archived_client_ref();
drop trigger if exists waiting_list_guard_archived_client on public.waiting_list;
create trigger waiting_list_guard_archived_client
  before insert or update of client_id on public.waiting_list
  for each row execute function public.guard_no_archived_client_ref();
revoke all on function public.guard_no_archived_client_ref() from public, anon, authenticated;
