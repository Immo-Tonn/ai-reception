-- ServiceOS — 0029: export of ONE client's data + register of data subject requests.
--
-- Numbering: 0028 (client anonymisation) is reserved by a separate, not yet merged
-- change. This migration does not depend on it; apply 0028 first when both are
-- released so the migration history stays in order.
--
-- 1. Permissions: clients.export (owner, admin); clients.export_internal_notes (owner).
-- 2. export_client_data(workspace, client, include_internal_notes, mode) — SECURITY
--    INVOKER: every row is read with the caller's own RLS, so an admin gets exactly
--    what they may see (no private / owner-only records, invoices only of buckets
--    they can access). A client of another workspace is invisible and reported
--    exactly like a missing one. Nothing is stored except ONE audit entry with
--    categories and counts (no names, contacts or notes).
--    Not exported: tokens, token hashes, staff names (third parties), other
--    clients. internal_notes only when the owner explicitly asks for them.
-- 3. client_export_account_link(...) — SECURITY DEFINER helper: booking_claims are
--    not readable by business users; returns only HOW MANY of this client's
--    appointments are linked to a client account (no account id, name or e-mail:
--    the account belongs to the person's platform account, not to the business).
-- 4. data_subject_requests — metadata only, never the exported content. Owner /
--    admin of the workspace (RLS). No DELETE (a register is kept). Lifecycle, enforced
--    by the database:
--      open -> in_progress -> export_generated -> delivered -> closed
--      closed is reachable from every state with a closure_reason (fulfilled,
--      rejected, withdrawn, identity_not_confirmed, other). It is final EXCEPT for
--      reopen_data_subject_request(): owner / admin (clients.reopen_request) may
--      reopen it (closed -> in_progress) with a reason from a fixed list; the history
--      of the closure stays in the audit trail, delivery and export history stay on
--      the row, and a client may not have two open requests of the same type.
--    export_generated: the server produced a file. It says NOTHING about delivery.
--    delivered: a staff member RECORDED a handover (date, channel); it is not a proof
--    of receipt. `fulfilled` for access / portability needs a recorded handover.
--    Only export_client_data() sets export_generated and the export fields; it
--    writes them and the audit entry in ONE transaction. A repeated export updates
--    the open request (export_count, last_exported_at); it never adds a duplicate.
--    Every registration, status change and identity confirmation writes an audit
--    entry from a trigger on the table: same transaction (a failed audit rolls the
--    step back), whichever path made the change. Who: actor_id; when: created_at;
--    what: fixed codes only (status, channel, reason), never personal data.
--
-- Additive: two functions, one helper, one table, three permission rows.

insert into public.role_permissions (role, permission) values
  ('owner', 'clients.export'), ('admin', 'clients.export'), ('owner', 'clients.export_internal_notes'),
  ('owner', 'clients.reopen_request'), ('admin', 'clients.reopen_request')
on conflict do nothing;

-- ---------------------------------------------------------------------------
-- Data subject requests (register)
-- ---------------------------------------------------------------------------
create table if not exists public.data_subject_requests (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references public.workspaces(id) on delete cascade,
  client_id uuid references public.clients(id) on delete set null,
  request_type text not null default 'access'
    check (request_type in ('access', 'portability', 'rectification', 'erasure', 'restriction', 'objection')),
  received_on date not null,
  due_on date not null,
  status text not null default 'open'
    check (status in ('open', 'in_progress', 'export_generated', 'delivered', 'closed')),
  identity_verified boolean not null default false,
  responsible_profile_id uuid references public.profiles(id) on delete set null,
  exported_categories text[] not null default '{}',
  export_count integer not null default 0 check (export_count >= 0),
  last_exported_at timestamptz,
  delivered_at timestamptz,
  delivery_channel text check (delivery_channel in ('email', 'post', 'in_person', 'portal', 'other')),
  closure_reason text check (closure_reason in ('fulfilled', 'rejected', 'withdrawn', 'identity_not_confirmed', 'other')),
  closed_at timestamptz,
  reopen_count integer not null default 0 check (reopen_count >= 0),
  last_reopen_reason text check (last_reopen_reason in ('closed_by_mistake', 'new_information', 'requester_contact', 'other')),
  created_by uuid references public.profiles(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint data_subject_requests_dates_chk check (due_on >= received_on),
  constraint data_subject_requests_categories_chk check (cardinality(exported_categories) <= 20),
  constraint data_subject_requests_closure_chk check ((status = 'closed') = (closure_reason is not null)),
  constraint data_subject_requests_delivery_chk check ((delivered_at is null) = (delivery_channel is null))
);
create index if not exists idx_data_subject_requests_client
  on public.data_subject_requests (workspace_id, client_id, received_on desc);
-- One open request per client, type and day: a repeated export cannot add a duplicate.
create unique index if not exists idx_data_subject_requests_open
  on public.data_subject_requests (workspace_id, client_id, request_type, received_on)
  where status <> 'closed';

create or replace function public.guard_data_subject_request()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_export boolean := coalesce(current_setting('serviceos.dsr_export', true), '') = 'on';
  v_reopen boolean := coalesce(current_setting('serviceos.dsr_reopen', true), '') = 'on';
begin
  if tg_op = 'INSERT' then
    if not v_export and (new.status <> 'open' or new.export_count <> 0 or new.last_exported_at is not null
                         or cardinality(new.exported_categories) > 0 or new.delivered_at is not null
                         or new.closed_at is not null or new.reopen_count <> 0 or new.last_reopen_reason is not null) then
      raise exception 'data_subject_request_invalid_state' using errcode = '23514';
    end if;
  else
    if new.workspace_id is distinct from old.workspace_id
       or new.client_id is distinct from old.client_id
       or new.request_type is distinct from old.request_type
       or new.created_by is distinct from old.created_by
       or new.created_at is distinct from old.created_at then
      raise exception 'data_subject_request_identity_immutable' using errcode = '23514';
    end if;
    if old.status = 'closed' then
      -- Final, except through reopen_data_subject_request().
      if not (v_reopen and new.status = 'in_progress' and new.last_reopen_reason is not null) then
        raise exception 'data_subject_request_closed' using errcode = '23514';
      end if;
      if (select auth.uid()) is not null
         and not public.has_workspace_permission(new.workspace_id, 'clients.reopen_request') then
        raise exception 'data_subject_request_reopen_not_permitted' using errcode = '42501';
      end if;
    end if;
    if not v_reopen and (new.reopen_count, new.last_reopen_reason) is distinct from (old.reopen_count, old.last_reopen_reason) then
      raise exception 'data_subject_request_reopen_fields_protected' using errcode = '23514';
    end if;
    if not v_export and (new.export_count, new.last_exported_at, new.exported_categories)
                        is distinct from (old.export_count, old.last_exported_at, old.exported_categories) then
      raise exception 'data_subject_request_export_fields_protected' using errcode = '23514';
    end if;
    if (new.delivered_at, new.delivery_channel) is distinct from (old.delivered_at, old.delivery_channel)
       and not (old.status = 'export_generated' and new.status = 'delivered') then
      raise exception 'data_subject_request_invalid_transition' using errcode = '23514';
    end if;
    if new.status is distinct from old.status and not (
         (old.status = 'open' and new.status in ('in_progress', 'closed'))
      or (old.status = 'in_progress' and new.status = 'closed')
      or (old.status = 'export_generated' and new.status in ('delivered', 'closed'))
      or (old.status = 'delivered' and new.status = 'closed')
      or (v_reopen and old.status = 'closed' and new.status = 'in_progress')
      or (v_export and old.status in ('open', 'in_progress') and new.status = 'export_generated')) then
      raise exception 'data_subject_request_invalid_transition' using errcode = '23514';
    end if;
    if new.status = 'delivered' and new.delivered_at is null then
      raise exception 'data_subject_request_invalid_transition' using errcode = '23514';
    end if;
    if new.status = 'closed' then
      if new.closure_reason = 'fulfilled' and new.request_type in ('access', 'portability') and new.delivered_at is null then
        raise exception 'data_subject_request_not_delivered' using errcode = '23514';
      end if;
      new.closed_at := now();
    end if;
  end if;
  if new.client_id is not null and not exists (
       select 1 from public.clients c where c.id = new.client_id and c.workspace_id = new.workspace_id) then
    raise exception 'cross_workspace_reference' using errcode = '23514';
  end if;
  if new.responsible_profile_id is not null and not exists (
       select 1 from public.workspace_members m
        where m.workspace_id = new.workspace_id and m.profile_id = new.responsible_profile_id) then
    raise exception 'cross_workspace_reference' using errcode = '23514';
  end if;
  new.updated_at := now();
  return new;
end;
$$;
drop trigger if exists data_subject_requests_guard on public.data_subject_requests;
create trigger data_subject_requests_guard
  before insert or update on public.data_subject_requests
  for each row execute function public.guard_data_subject_request();
revoke all on function public.guard_data_subject_request() from public, anon, authenticated;

create or replace function public.audit_data_subject_request()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_actor uuid := (select auth.uid());
  v_action text;
  v_summary text;
begin
  if tg_op = 'INSERT' then
    v_action := 'created';
    v_summary := 'Data subject request registered: ' || new.request_type || ', status ' || new.status;
  elsif new.status is distinct from old.status then
    v_action := 'statusChanged';
    v_summary := case
      when old.status = 'closed' then
        'Data subject request reopened: closed (' || old.closure_reason || ') -> in_progress (' || new.last_reopen_reason || ')'
      else
        'Data subject request: ' || old.status || ' -> ' || new.status
          || case when new.status = 'delivered' then ' (' || new.delivery_channel || ')'
                  when new.status = 'closed' then ' (' || new.closure_reason || ')'
                  else '' end
      end;
  elsif new.identity_verified and not old.identity_verified then
    v_action := 'updated';
    v_summary := 'Data subject request: identity marked as verified';
  else
    return null; -- no step happened (e.g. a repeated export): nothing to record here
  end if;
  insert into public.audit_logs (workspace_id, actor_id, action, entity_type, entity_id, summary, source)
  values (new.workspace_id, v_actor, v_action, 'dataSubjectRequest', new.id::text, v_summary,
          case when v_actor is null then 'automation' else 'user' end);
  return null;
end;
$$;
drop trigger if exists data_subject_requests_audit on public.data_subject_requests;
create trigger data_subject_requests_audit
  after insert or update on public.data_subject_requests
  for each row execute function public.audit_data_subject_request();
revoke all on function public.audit_data_subject_request() from public, anon, authenticated, service_role;

alter table public.data_subject_requests enable row level security;
revoke all on table public.data_subject_requests from public, anon;
grant select, insert, update on table public.data_subject_requests to authenticated;
grant all on table public.data_subject_requests to service_role;

drop policy if exists data_subject_requests_select on public.data_subject_requests;
create policy data_subject_requests_select on public.data_subject_requests
  for select to authenticated
  using (public.has_workspace_permission(workspace_id, 'clients.export'));
drop policy if exists data_subject_requests_insert on public.data_subject_requests;
create policy data_subject_requests_insert on public.data_subject_requests
  for insert to authenticated
  with check (public.has_workspace_permission(workspace_id, 'clients.export')
              and created_by is not distinct from (select auth.uid()));
drop policy if exists data_subject_requests_update on public.data_subject_requests;
create policy data_subject_requests_update on public.data_subject_requests
  for update to authenticated
  using (public.has_workspace_permission(workspace_id, 'clients.export'))
  with check (public.has_workspace_permission(workspace_id, 'clients.export'));

-- ---------------------------------------------------------------------------
-- Reopen a closed request (owner / admin)
-- ---------------------------------------------------------------------------
-- SECURITY INVOKER: the caller's RLS applies (update needs clients.export) and the
-- guard trigger runs too; clients.reopen_request is checked explicitly. One call =
-- one transaction: the audit entry (trigger) is part of it, a failed audit rolls the
-- reopening back. Fixed reasons only, no free text.
create or replace function public.reopen_data_subject_request(p_workspace_id uuid, p_request_id uuid, p_reason text)
returns jsonb
language plpgsql
security invoker
set search_path = ''
as $$
declare
  v_row public.data_subject_requests%rowtype;
  v_count integer;
begin
  if (select auth.uid()) is null
     or not public.has_workspace_permission(p_workspace_id, 'clients.reopen_request') then
    raise exception 'data_subject_request_reopen_not_permitted' using errcode = '42501';
  end if;
  if p_reason is null or p_reason not in ('closed_by_mistake', 'new_information', 'requester_contact', 'other') then
    raise exception 'invalid_input' using errcode = '22023';
  end if;

  select * into v_row
    from public.data_subject_requests d
   where d.id = p_request_id and d.workspace_id = p_workspace_id
   for update;
  if not found then
    raise exception 'request_not_found' using errcode = 'P0002';
  end if;
  if v_row.status <> 'closed' then
    raise exception 'data_subject_request_not_closed' using errcode = '23514';
  end if;
  -- One open request per client and type; unique_violation maps to "conflict".
  if v_row.client_id is not null and exists (
       select 1 from public.data_subject_requests o
        where o.workspace_id = p_workspace_id and o.client_id = v_row.client_id
          and o.request_type = v_row.request_type and o.status <> 'closed' and o.id <> v_row.id) then
    raise exception 'data_subject_request_conflict' using errcode = '23505';
  end if;

  perform set_config('serviceos.dsr_reopen', 'on', true);
  update public.data_subject_requests d
     set status = 'in_progress', closure_reason = null, closed_at = null,
         reopen_count = d.reopen_count + 1, last_reopen_reason = p_reason
   where d.id = p_request_id and d.workspace_id = p_workspace_id
  returning d.reopen_count into v_count;
  -- RLS can skip the row silently.
  if not found then
    raise exception 'data_subject_request_reopen_not_permitted' using errcode = '42501';
  end if;
  perform set_config('serviceos.dsr_reopen', 'off', true);

  return jsonb_build_object('status', 'in_progress', 'reopenCount', v_count);
end;
$$;
revoke all on function public.reopen_data_subject_request(uuid, uuid, text) from public, anon, service_role;
grant execute on function public.reopen_data_subject_request(uuid, uuid, text) to authenticated;

-- ---------------------------------------------------------------------------
-- Account link (count only)
-- ---------------------------------------------------------------------------
create or replace function public.client_export_account_link(p_workspace_id uuid, p_client_id uuid)
returns integer
language plpgsql
stable
security definer
set search_path = ''
as $$
begin
  if (select auth.uid()) is null or not public.has_workspace_permission(p_workspace_id, 'clients.export') then
    raise exception 'client_export_not_permitted' using errcode = '42501';
  end if;
  return (select count(*)::int
            from public.booking_claims b
            join public.appointments a on a.id = b.appointment_id
           where a.workspace_id = p_workspace_id and a.client_id = p_client_id
             and b.claimed_by is not null);
end;
$$;
revoke all on function public.client_export_account_link(uuid, uuid) from public, anon;
grant execute on function public.client_export_account_link(uuid, uuid) to authenticated;

-- ---------------------------------------------------------------------------
-- Export
-- ---------------------------------------------------------------------------
create or replace function public.export_client_data(
  p_workspace_id uuid,
  p_client_id uuid,
  p_include_internal_notes boolean default false,
  p_mode text default 'admin',
  p_request jsonb default null
)
returns jsonb
language plpgsql
security invoker
set search_path = ''
as $$
declare
  v_profile jsonb;
  v_appointments jsonb;
  v_invoices jsonb;
  v_waiting jsonb;
  v_leads jsonb;
  v_quotes jsonb;
  v_jobs jsonb;
  v_projects jsonb;
  v_inbox jsonb;
  v_linked int;
  v_counts jsonb;
  v_categories text[];
  v_request_id uuid;
  v_verified boolean;
  v_request jsonb;
begin
  if (select auth.uid()) is null or not public.has_workspace_permission(p_workspace_id, 'clients.export') then
    raise exception 'client_export_not_permitted' using errcode = '42501';
  end if;
  if p_mode not in ('admin', 'data_subject_request') then
    raise exception 'invalid_mode' using errcode = '22023';
  end if;
  if coalesce(p_include_internal_notes, false)
     and not public.has_workspace_permission(p_workspace_id, 'clients.export_internal_notes') then
    raise exception 'client_export_internal_notes_not_permitted' using errcode = '42501';
  end if;

  select jsonb_build_object('id', c.id, 'name', c.name, 'email', c.email, 'phone', c.phone,
                            'tags', to_jsonb(c.tags), 'notes', c.notes,
                            'createdAt', c.created_at, 'updatedAt', c.updated_at)
    into v_profile
    from public.clients c
   where c.id = p_client_id and c.workspace_id = p_workspace_id;
  if v_profile is null then
    raise exception 'client_not_found' using errcode = 'P0002';
  end if;

  select coalesce(jsonb_agg(x.j order by x.starts_at), '[]'::jsonb) into v_appointments from (
    select a.starts_at,
           jsonb_strip_nulls(jsonb_build_object(
             'id', a.id, 'startsAt', a.starts_at, 'endsAt', a.ends_at, 'timezone', a.timezone,
             'status', a.status, 'service', s.name, 'price', a.price, 'currency', a.currency,
             'source', a.source, 'clientNotes', a.client_notes, 'createdAt', a.created_at,
             'internalNotes', case when p_include_internal_notes then a.internal_notes end)) as j
      from public.appointments a
      left join public.services s on s.id = a.service_id
     where a.workspace_id = p_workspace_id and a.client_id = p_client_id) x;

  select coalesce(jsonb_agg(x.j order by x.created_at), '[]'::jsonb) into v_invoices from (
    select i.created_at,
           jsonb_build_object(
             'number', i.number, 'status', i.status, 'issuedAt', i.issued_at, 'dueAt', i.due_at,
             'amount', i.amount, 'currency', i.currency, 'clientName', i.client_name, 'notes', i.notes,
             'items', coalesce((select jsonb_agg(jsonb_build_object('description', it.description,
                                                                      'quantity', it.quantity,
                                                                      'unitPrice', it.unit_price)
                                                   order by it.created_at)
                                  from public.invoice_items it where it.invoice_id = i.id), '[]'::jsonb)) as j
      from public.invoices i
     where i.workspace_id = p_workspace_id and i.client_id = p_client_id) x;

  select coalesce(jsonb_agg(x.j order by x.created_at), '[]'::jsonb) into v_waiting from (
    select w.created_at,
           jsonb_build_object(
             'service', s.name, 'earliestDate', w.earliest_date, 'latestDate', w.latest_date,
             'preferredDays', to_jsonb(w.preferred_days), 'preferredTimeStart', w.preferred_time_start,
             'preferredTimeEnd', w.preferred_time_end, 'name', w.guest_name, 'phone', w.guest_phone,
             'email', w.guest_email, 'notes', w.notes, 'status', w.status, 'createdAt', w.created_at) as j
      from public.waiting_list w
      left join public.services s on s.id = w.service_id
     where w.workspace_id = p_workspace_id and w.client_id = p_client_id) x;

  select coalesce(jsonb_agg(jsonb_build_object('title', l.title, 'clientName', l.client_name, 'notes', l.notes,
                                               'stage', l.stage, 'estimatedValue', l.estimated_value,
                                               'currency', l.currency, 'createdAt', l.created_at)
                            order by l.created_at), '[]'::jsonb)
    into v_leads from public.leads l
   where l.workspace_id = p_workspace_id and l.client_id = p_client_id;

  select coalesce(jsonb_agg(jsonb_build_object('title', q.title, 'clientName', q.client_name, 'notes', q.notes,
                                               'status', q.status, 'amount', q.amount, 'currency', q.currency,
                                               'validUntil', q.valid_until, 'createdAt', q.created_at)
                            order by q.created_at), '[]'::jsonb)
    into v_quotes from public.quotes q
   where q.workspace_id = p_workspace_id and q.client_id = p_client_id;

  select coalesce(jsonb_agg(jsonb_build_object('title', j.title, 'clientName', j.client_name, 'notes', j.notes,
                                               'status', j.status, 'amount', j.amount, 'currency', j.currency,
                                               'startsOn', j.starts_on, 'dueOn', j.due_on, 'createdAt', j.created_at)
                            order by j.created_at), '[]'::jsonb)
    into v_jobs from public.jobs j
   where j.workspace_id = p_workspace_id and j.client_id = p_client_id;

  select coalesce(jsonb_agg(jsonb_build_object('title', p.title, 'clientName', p.client_name, 'notes', p.notes,
                                               'status', p.status, 'startsOn', p.starts_on, 'endsOn', p.ends_on,
                                               'createdAt', p.created_at)
                            order by p.created_at), '[]'::jsonb)
    into v_projects from public.projects p
   where p.workspace_id = p_workspace_id and p.client_id = p_client_id;

  select coalesce(jsonb_agg(jsonb_build_object('type', e.code, 'createdAt', e.created_at) order by e.created_at), '[]'::jsonb)
    into v_inbox from public.inbox_events e
   where e.workspace_id = p_workspace_id
     and (e.client_id = p_client_id or e.details->>'client_id' = p_client_id::text);

  v_linked := public.client_export_account_link(p_workspace_id, p_client_id);

  v_counts := jsonb_build_object(
    'profile', 1,
    'appointments', jsonb_array_length(v_appointments),
    'invoices', jsonb_array_length(v_invoices),
    'waitingList', jsonb_array_length(v_waiting),
    'leads', jsonb_array_length(v_leads),
    'quotes', jsonb_array_length(v_quotes),
    'jobs', jsonb_array_length(v_jobs),
    'projects', jsonb_array_length(v_projects),
    'inboxEvents', jsonb_array_length(v_inbox));

  -- Request register: same transaction as the audit entry below. "Generated" only:
  -- nothing here claims that the file reached anyone.
  if p_mode = 'data_subject_request' then
    if p_request is null then
      raise exception 'invalid_input' using errcode = '22023';
    end if;
    select coalesce(array_agg(k order by k), '{}') into v_categories
      from jsonb_each_text(v_counts) t(k, v) where v::int > 0;
    v_request_id := nullif(p_request->>'requestId', '')::uuid;
    if v_request_id is null then
      select d.id into v_request_id
        from public.data_subject_requests d
       where d.workspace_id = p_workspace_id and d.client_id = p_client_id and d.status <> 'closed'
         and d.request_type = p_request->>'type' and d.received_on = (p_request->>'receivedOn')::date;
    end if;

    perform set_config('serviceos.dsr_export', 'on', true);
    if v_request_id is null then
      if (p_request->>'identityVerified') is distinct from 'true' then
        raise exception 'identity_not_verified' using errcode = '22023';
      end if;
      insert into public.data_subject_requests
        (workspace_id, client_id, request_type, received_on, due_on, status, identity_verified,
         responsible_profile_id, exported_categories, export_count, last_exported_at, created_by)
      values (p_workspace_id, p_client_id, p_request->>'type', (p_request->>'receivedOn')::date, (p_request->>'dueOn')::date,
              'export_generated', true, (select auth.uid()), v_categories, 1, now(), (select auth.uid()))
      returning jsonb_build_object('id', id, 'status', status, 'exportCount', export_count) into v_request;
    else
      select d.identity_verified or (p_request->>'identityVerified') is not distinct from 'true' into v_verified
        from public.data_subject_requests d
       where d.id = v_request_id and d.workspace_id = p_workspace_id and d.client_id = p_client_id
         and d.status <> 'closed'
       for update;
      if not found then
        raise exception 'request_not_found' using errcode = 'P0002';
      end if;
      if not v_verified then
        raise exception 'identity_not_verified' using errcode = '22023';
      end if;
      update public.data_subject_requests d
         set exported_categories = v_categories,
             export_count = d.export_count + 1,
             last_exported_at = now(),
             identity_verified = true,
             status = case when d.status = 'delivered' then 'delivered' else 'export_generated' end
       where d.id = v_request_id
      returning jsonb_build_object('id', d.id, 'status', d.status, 'exportCount', d.export_count) into v_request;
    end if;
    perform set_config('serviceos.dsr_export', 'off', true);
  end if;

  -- Audit: who / when / which client / categories and counts. No personal data.
  insert into public.audit_logs (workspace_id, actor_id, action, entity_type, entity_id, summary, source)
  values (p_workspace_id, (select auth.uid()), 'exported', 'client', p_client_id::text,
          left('Client data export generated (' || p_mode || ', internal notes '
               || case when p_include_internal_notes then 'included' else 'excluded' end || '): '
               || (select string_agg(k || ' ' || v, ', ' order by k) from jsonb_each_text(v_counts) t(k, v)), 500),
          'user');

  return jsonb_build_object(
    'meta', jsonb_build_object('mode', p_mode, 'exportedAt', now(), 'clientId', p_client_id,
                               'internalNotesIncluded', coalesce(p_include_internal_notes, false), 'counts', v_counts),
    'profile', v_profile,
    'appointments', v_appointments,
    'invoices', v_invoices,
    'waitingList', v_waiting,
    'leads', v_leads,
    'quotes', v_quotes,
    'jobs', v_jobs,
    'projects', v_projects,
    'inboxEvents', v_inbox,
    'onlineAccount', jsonb_build_object('linkedAppointments', v_linked),
    'request', v_request);
end;
$$;
revoke all on function public.export_client_data(uuid, uuid, boolean, text, jsonb) from public, anon;
grant execute on function public.export_client_data(uuid, uuid, boolean, text, jsonb) to authenticated;
