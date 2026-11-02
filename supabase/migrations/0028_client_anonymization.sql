-- ServiceOS — 0028: anonymise a client (GDPR erasure inside one workspace).
--
-- The client row is NOT deleted: appointments, invoices and work items keep
-- pointing at it so the business history stays consistent. Instead, in ONE
-- transaction (any error rolls everything back):
--   A (removed)      clients.email / phone / tags / notes; appointments.client_notes /
--                    internal_notes / title of this client; waiting-list contact
--                    copies and notes; Inbox previews and client snapshots (same rule
--                    as forget_client_in_inbox from 0027); notes of leads / quotes /
--                    jobs / projects; the client-account link of this client's
--                    appointments (booking_claims unlinked, booking token expired).
--   B (pseudonymised) clients.name and the client_name copies in leads / quotes /
--                    jobs / projects become 'Gelöschter Kunde'.
--   C (kept)         invoices (number, client_name, amounts, dates, status) — retention
--                    obligation for business records (Needs legal review); appointment
--                    dates, services, prices, statuses; internal ids.
-- NOT covered here (other developer / separate decision): Supabase Auth users and
-- client_accounts (name, phone, e-mail of a client ACCOUNT), the client's ICS feed
-- token, backups. So this is not a full erasure of a person who also has an account.
--
-- Who: only the workspace OWNER (permission clients.erase), checked in the database.
-- A client of another workspace looks exactly like a missing one (no existence leak).
-- Idempotent: a second call returns status 'already' and changes nothing. The client
-- row is locked (FOR UPDATE), so parallel calls run one after another.
-- After anonymisation the personal fields of the row are frozen and no new
-- appointment / waiting-list entry can use the client.
--
-- Erasure ledger: client_erasure_ledger keeps only (workspace_id, client_id, erased_at)
-- — ids, no names or contact data. After restoring an OLDER backup, run
-- reapply_client_erasures(<ledger rows exported before the restore>) with the service
-- role: it anonymises every listed client again. The ledger itself is inside the same
-- database, so a copy must be kept outside it (team decision, see BACKUP_RECOVERY.md).
--
-- Additive: one column, one table, functions, triggers, one permission row.
-- No existing row is changed by this migration.

alter table public.clients
  add column if not exists anonymized_at timestamptz;

insert into public.role_permissions (role, permission) values ('owner', 'clients.erase')
on conflict do nothing;

create table if not exists public.client_erasure_ledger (
  workspace_id uuid not null,
  client_id uuid not null,
  erased_at timestamptz not null default now(),
  primary key (workspace_id, client_id)
);
alter table public.client_erasure_ledger enable row level security;
revoke all on table public.client_erasure_ledger from public, anon, authenticated;
grant select, insert on table public.client_erasure_ledger to service_role;

-- Core: no permission check here, so it is never callable directly by API roles.
create or replace function public.anonymize_client_core(p_workspace_id uuid, p_client_id uuid, p_actor uuid)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_label constant text := 'Gelöschter Kunde';
  v_anonymized_at timestamptz;
  v_appts int := 0;
  v_waiting int := 0;
  v_inbox int := 0;
  v_claims int := 0;
  v_work int := 0;
  v_n int;
begin
  select c.anonymized_at into v_anonymized_at
    from public.clients c
   where c.id = p_client_id and c.workspace_id = p_workspace_id
   for update;
  if not found then
    raise exception 'client_not_found' using errcode = 'P0002';
  end if;
  if v_anonymized_at is not null then
    insert into public.client_erasure_ledger (workspace_id, client_id, erased_at)
    values (p_workspace_id, p_client_id, v_anonymized_at)
    on conflict do nothing;
    return jsonb_build_object('status', 'already');
  end if;

  perform set_config('serviceos.client_erasure', 'on', true);

  update public.clients
     set name = v_label, email = '', phone = '', tags = '{}', notes = '',
         anonymized_at = now(), updated_at = now()
   where id = p_client_id;

  update public.appointments
     set client_notes = '', internal_notes = '', title = null
   where workspace_id = p_workspace_id and client_id = p_client_id;
  get diagnostics v_appts = row_count;

  -- Unlink the client account and expire the booking token (no row is deleted).
  update public.booking_claims b
     set claimed_by = null, claimed_at = null, expires_at = least(b.expires_at, now())
    from public.appointments a
   where b.appointment_id = a.id and a.workspace_id = p_workspace_id and a.client_id = p_client_id;
  get diagnostics v_claims = row_count;

  update public.waiting_list
     set guest_name = v_label, guest_phone = '', guest_email = '', notes = ''
   where workspace_id = p_workspace_id and client_id = p_client_id;
  get diagnostics v_waiting = row_count;

  update public.inbox_events e
     set details = e.details - 'client_name' - 'client_id', preview = '', client_id = null
   where e.workspace_id = p_workspace_id
     and (e.client_id = p_client_id or e.details->>'client_id' = p_client_id::text);
  get diagnostics v_inbox = row_count;

  update public.leads set client_name = v_label, notes = ''
   where workspace_id = p_workspace_id and client_id = p_client_id;
  get diagnostics v_n = row_count; v_work := v_work + v_n;
  update public.quotes set client_name = v_label, notes = ''
   where workspace_id = p_workspace_id and client_id = p_client_id;
  get diagnostics v_n = row_count; v_work := v_work + v_n;
  update public.jobs set client_name = v_label, notes = ''
   where workspace_id = p_workspace_id and client_id = p_client_id;
  get diagnostics v_n = row_count; v_work := v_work + v_n;
  update public.projects set client_name = v_label, notes = ''
   where workspace_id = p_workspace_id and client_id = p_client_id;
  get diagnostics v_n = row_count; v_work := v_work + v_n;

  insert into public.client_erasure_ledger (workspace_id, client_id)
  values (p_workspace_id, p_client_id)
  on conflict do nothing;

  -- No personal data in the audit trail: ids and a fixed text only.
  insert into public.audit_logs (workspace_id, actor_id, action, entity_type, entity_id, summary, source)
  values (p_workspace_id, p_actor, 'updated', 'client', p_client_id::text, 'Client anonymized',
          case when p_actor is null then 'automation' else 'user' end);

  perform set_config('serviceos.client_erasure', 'off', true);

  return jsonb_build_object('status', 'anonymized', 'appointments', v_appts, 'bookingClaims', v_claims,
                            'waitingList', v_waiting, 'inboxEvents', v_inbox, 'workItems', v_work);
end;
$$;
revoke all on function public.anonymize_client_core(uuid, uuid, uuid) from public, anon, authenticated, service_role;

-- API entry point for the signed-in owner.
create or replace function public.anonymize_client(p_workspace_id uuid, p_client_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
begin
  if (select auth.uid()) is null
     or not public.has_workspace_permission(p_workspace_id, 'clients.erase') then
    raise exception 'client_erase_not_permitted' using errcode = '42501';
  end if;
  return public.anonymize_client_core(p_workspace_id, p_client_id, (select auth.uid()));
end;
$$;
revoke all on function public.anonymize_client(uuid, uuid) from public, anon;
grant execute on function public.anonymize_client(uuid, uuid) to authenticated;

-- After a restore from an older backup: re-apply erasures recorded outside the
-- restored database. p_entries = [{"workspace_id": "...", "client_id": "..."}, ...].
create or replace function public.reapply_client_erasures(p_entries jsonb)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_entry jsonb;
  v_result jsonb;
  v_reapplied int := 0;
  v_already int := 0;
  v_missing int := 0;
begin
  if jsonb_typeof(p_entries) is distinct from 'array' then
    raise exception 'invalid_entries' using errcode = '22023';
  end if;
  for v_entry in select value from jsonb_array_elements(p_entries) loop
    begin
      v_result := public.anonymize_client_core((v_entry->>'workspace_id')::uuid, (v_entry->>'client_id')::uuid, null);
      if v_result->>'status' = 'already' then v_already := v_already + 1; else v_reapplied := v_reapplied + 1; end if;
    exception when sqlstate 'P0002' then
      v_missing := v_missing + 1;
    end;
  end loop;
  return jsonb_build_object('reapplied', v_reapplied, 'already', v_already, 'missing', v_missing);
end;
$$;
revoke all on function public.reapply_client_erasures(jsonb) from public, anon, authenticated;
grant execute on function public.reapply_client_erasures(jsonb) to service_role;

-- Freeze an anonymised client: personal fields and the marker change only inside
-- anonymize_client_core.
create or replace function public.guard_anonymized_client()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if coalesce(current_setting('serviceos.client_erasure', true), '') = 'on' then
    return new;
  end if;
  if new.anonymized_at is distinct from old.anonymized_at
     or (old.anonymized_at is not null
         and (new.name, new.email, new.phone, new.tags, new.notes)
             is distinct from (old.name, old.email, old.phone, old.tags, old.notes)) then
    raise exception 'client_anonymized' using errcode = '23514';
  end if;
  return new;
end;
$$;
drop trigger if exists clients_guard_anonymized on public.clients;
create trigger clients_guard_anonymized
  before update on public.clients
  for each row execute function public.guard_anonymized_client();
revoke all on function public.guard_anonymized_client() from public, anon, authenticated;

-- No new appointment or waiting-list entry for an anonymised client.
create or replace function public.guard_no_anonymized_client_ref()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if new.client_id is not null
     and (tg_op = 'INSERT' or new.client_id is distinct from old.client_id)
     and exists (select 1 from public.clients c where c.id = new.client_id and c.anonymized_at is not null) then
    raise exception 'client_anonymized' using errcode = '23514';
  end if;
  return new;
end;
$$;
drop trigger if exists appointments_guard_anonymized_client on public.appointments;
create trigger appointments_guard_anonymized_client
  before insert or update of client_id on public.appointments
  for each row execute function public.guard_no_anonymized_client_ref();
drop trigger if exists waiting_list_guard_anonymized_client on public.waiting_list;
create trigger waiting_list_guard_anonymized_client
  before insert or update of client_id on public.waiting_list
  for each row execute function public.guard_no_anonymized_client_ref();
revoke all on function public.guard_no_anonymized_client_ref() from public, anon, authenticated;
