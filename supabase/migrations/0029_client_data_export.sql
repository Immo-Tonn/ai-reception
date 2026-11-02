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
-- 4. data_subject_requests — metadata only (type, dates, status, identity checked,
--    responsible person, exported categories). Never the exported content.
--    Owner / admin of the workspace (RLS). No DELETE (a register is kept).
--
-- Additive: two functions, one helper, one table, three permission rows.

insert into public.role_permissions (role, permission) values
  ('owner', 'clients.export'), ('admin', 'clients.export'), ('owner', 'clients.export_internal_notes')
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
  status text not null default 'open' check (status in ('open', 'in_progress', 'completed', 'rejected')),
  identity_verified boolean not null default false,
  responsible_profile_id uuid references public.profiles(id) on delete set null,
  exported_categories text[] not null default '{}',
  completed_at timestamptz,
  created_by uuid references public.profiles(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint data_subject_requests_dates_chk check (due_on >= received_on),
  constraint data_subject_requests_categories_chk check (cardinality(exported_categories) <= 20)
);
create index if not exists idx_data_subject_requests_client
  on public.data_subject_requests (workspace_id, client_id, received_on desc);

create or replace function public.guard_data_subject_request()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if tg_op = 'UPDATE' and (new.workspace_id is distinct from old.workspace_id
                           or new.client_id is distinct from old.client_id
                           or new.created_by is distinct from old.created_by
                           or new.created_at is distinct from old.created_at) then
    raise exception 'data_subject_request_identity_immutable' using errcode = '23514';
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
  if new.status = 'completed' and new.completed_at is null then
    new.completed_at := now();
  elsif new.status <> 'completed' then
    new.completed_at := null;
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
  p_mode text default 'admin'
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

  -- Audit: who / when / which client / categories and counts. No personal data.
  insert into public.audit_logs (workspace_id, actor_id, action, entity_type, entity_id, summary, source)
  values (p_workspace_id, (select auth.uid()), 'exported', 'client', p_client_id::text,
          left('Client data exported (' || p_mode || ', internal notes '
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
    'onlineAccount', jsonb_build_object('linkedAppointments', v_linked));
end;
$$;
revoke all on function public.export_client_data(uuid, uuid, boolean, text) from public, anon;
grant execute on function public.export_client_data(uuid, uuid, boolean, text) to authenticated;
