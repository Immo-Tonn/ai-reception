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
--    API users change the status ONLY through set_client_archived(): status and
--    audit entry are one transaction, so a failed audit rolls the status back. A
--    direct UPDATE of archived_at, even by the owner, is refused (it would leave no
--    audit entry). The service role (no auth.uid()) is not restricted.
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
-- Additive: one column, one index, one permission row, one function, triggers. No row is changed.

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
    if (select auth.uid()) is not null then
      if not public.has_workspace_permission(new.workspace_id, 'clients.archive') then
        raise exception 'client_archive_not_permitted' using errcode = '42501';
      end if;
      if coalesce(current_setting('serviceos.client_archive_change', true), '') <> 'on' then
        raise exception 'client_archive_use_function' using errcode = '42501';
      end if;
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

-- The only way for an API user to archive / restore. SECURITY INVOKER on purpose:
-- the caller's RLS applies to the client row and to audit_logs (clients_update needs
-- clients.edit; audit_logs_insert needs membership, source 'user' and actor = caller),
-- and the trigger above runs as well. clients.archive is checked explicitly because
-- RLS alone would allow a manager. One plpgsql call = one transaction: any error,
-- including a failed audit insert, rolls the status back.
create or replace function public.set_client_archived(p_workspace_id uuid, p_client_id uuid, p_archive boolean)
returns jsonb
language plpgsql
security invoker
set search_path = ''
as $$
declare
  v_old timestamptz;
  v_new timestamptz;
begin
  if (select auth.uid()) is null
     or not public.has_workspace_permission(p_workspace_id, 'clients.archive') then
    raise exception 'client_archive_not_permitted' using errcode = '42501';
  end if;
  if p_archive is null then
    raise exception 'invalid_input' using errcode = '22023';
  end if;

  -- Own workspace only; the lock serialises parallel calls for one client.
  select c.archived_at into v_old
    from public.clients c
   where c.id = p_client_id and c.workspace_id = p_workspace_id
   for update;
  if not found then
    raise exception 'client_not_found' using errcode = 'P0002';
  end if;

  if p_archive = (v_old is not null) then
    return jsonb_build_object('status', 'unchanged', 'archivedAt', v_old);
  end if;

  perform set_config('serviceos.client_archive_change', 'on', true);
  update public.clients c
     set archived_at = case when p_archive then now() end
   where c.id = p_client_id and c.workspace_id = p_workspace_id
  returning c.archived_at into v_new;
  -- RLS can skip the row silently (a role with clients.archive but no clients.edit).
  if not found then
    raise exception 'client_archive_not_permitted' using errcode = '42501';
  end if;
  perform set_config('serviceos.client_archive_change', 'off', true);

  -- No personal data: fixed text and ids only.
  insert into public.audit_logs (workspace_id, actor_id, action, entity_type, entity_id, summary, source)
  values (p_workspace_id, (select auth.uid()), 'updated', 'client', p_client_id::text,
          case when p_archive then 'Client archived' else 'Client restored from archive' end, 'user');

  return jsonb_build_object('status', case when p_archive then 'archived' else 'restored' end, 'archivedAt', v_new);
end;
$$;
revoke all on function public.set_client_archived(uuid, uuid, boolean) from public, anon, service_role;
grant execute on function public.set_client_archived(uuid, uuid, boolean) to authenticated;

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
