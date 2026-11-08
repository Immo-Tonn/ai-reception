-- ServiceOS — 0033: audit_logs protection
--
-- Until now any signed-in member could INSERT into audit_logs through the API
-- (policy audit_logs_insert, 0012) and so write false entries into the audit trail,
-- and several functions wrote their own entries with the caller's rights. After
-- this migration:
--   * signed-in users (and anon) have NO write privilege on audit_logs; they can
--     only read (RLS: audit_log.view). Updates and deletes are impossible for every
--     API role.
--   * the application writes through ONE server module with the service role
--     (src/server/audit): it verifies the user and the workspace membership and
--     takes action / entity type from fixed lists. The service role has INSERT only.
--   * archive, retention setting and export are audited INSIDE the database, in the
--     same transaction as the change (triggers, and one narrow definer function for
--     the export whose transaction-local flag only export_client_data can set).
--   * existing SECURITY DEFINER functions that write audit entries (booking,
--     business profile, client accounts, scheduling, anonymization, data subject
--     requests) keep working: they run as the table owner.
--   * EXECUTE is revoked from an explicit list of application TRIGGER functions
--     (trigger functions need no EXECUTE at fire time; nothing calls them through
--     the API). System functions and extensions are not touched.
--
-- KNOWN LIMITATION: for ordinary services the business change and the audit entry
-- are two separate requests (not one transaction). A failed audit write leaves the
-- change in place and is logged without personal data. See docs/GDPR_IMPLEMENTATION_PLAN.md.
--
-- DEPLOY ORDER: apply this migration only AFTER the code that writes through the
-- server module is live. The previous code inserted with the user's token and would
-- lose every audit entry once this runs. The new code also works BEFORE this
-- migration (service role inserts are allowed by the old table rights too).

-- 1. No direct insert for signed-in users ---------------------------------------
drop policy if exists audit_logs_insert on public.audit_logs;
revoke all on table public.audit_logs from public, anon, authenticated, service_role;
grant select on table public.audit_logs to authenticated;
grant insert on table public.audit_logs to service_role;

-- 2. Archive: audited by a trigger, same transaction ----------------------------
create or replace function public.audit_client_archive()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_actor uuid := (select auth.uid());
begin
  -- No personal data: fixed text and ids only.
  insert into public.audit_logs (workspace_id, actor_id, action, entity_type, entity_id, summary, source)
  values (new.workspace_id, v_actor, 'updated', 'client', new.id::text,
          case when new.archived_at is not null then 'Client archived' else 'Client restored from archive' end,
          case when v_actor is null then 'automation' else 'user' end);
  return null;
end;
$$;
drop trigger if exists clients_archive_audit on public.clients;
create trigger clients_archive_audit
  after update of archived_at on public.clients
  for each row when (old.archived_at is distinct from new.archived_at)
  execute function public.audit_client_archive();

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

  -- The audit entry is written by the trigger clients_archive_audit (same transaction).

  return jsonb_build_object('status', case when p_archive then 'archived' else 'restored' end, 'archivedAt', v_new);
end;
$$;

-- 3. Retention setting: audited by a trigger, same transaction ------------------
create or replace function public.audit_workspace_retention()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_actor uuid := (select auth.uid());
begin
  -- No personal data: fixed text, ids and the two numbers.
  insert into public.audit_logs (workspace_id, actor_id, action, entity_type, entity_id, summary, source)
  values (new.id, v_actor, 'updated', 'workspace', new.id::text,
          'Client data retention period changed from ' || old.client_retention_months || ' to ' || new.client_retention_months || ' months',
          case when v_actor is null then 'automation' else 'user' end);
  return null;
end;
$$;
drop trigger if exists workspaces_retention_audit on public.workspaces;
create trigger workspaces_retention_audit
  after update of client_retention_months on public.workspaces
  for each row when (old.client_retention_months is distinct from new.client_retention_months)
  execute function public.audit_workspace_retention();

create or replace function public.set_client_retention_months(p_workspace_id uuid, p_months integer)
returns jsonb
language plpgsql
security invoker
set search_path = ''
as $$
declare
  v_old integer;
  v_new integer;
begin
  if (select auth.uid()) is null
     or not public.has_workspace_permission(p_workspace_id, 'retention.manage') then
    raise exception 'retention_setting_not_permitted' using errcode = '42501';
  end if;
  if p_months is null then
    raise exception 'invalid_input' using errcode = '22023';
  end if;

  select w.client_retention_months into v_old
    from public.workspaces w
   where w.id = p_workspace_id
   for update;
  if not found then
    raise exception 'retention_setting_not_permitted' using errcode = '42501';
  end if;

  if v_old = p_months then
    return jsonb_build_object('status', 'unchanged', 'months', v_old);
  end if;

  perform set_config('serviceos.retention_setting_change', 'on', true);
  update public.workspaces w
     set client_retention_months = p_months, updated_at = now()
   where w.id = p_workspace_id
  returning w.client_retention_months into v_new;
  -- RLS can skip the row silently (a role with retention.manage but no settings.manage).
  if not found then
    raise exception 'retention_setting_not_permitted' using errcode = '42501';
  end if;
  perform set_config('serviceos.retention_setting_change', 'off', true);

  -- The audit entry is written by the trigger workspaces_retention_audit (same transaction).

  return jsonb_build_object('status', 'changed', 'months', v_new);
end;
$$;

-- 4. Export: narrow definer function, usable only from export_client_data -------
create or replace function public.record_client_export_audit(
  p_workspace_id uuid,
  p_client_id uuid,
  p_mode text,
  p_include_internal_notes boolean,
  p_counts jsonb
)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_actor uuid := (select auth.uid());
begin
  if coalesce(current_setting('serviceos.client_export_audit', true), '') <> 'on'
     or v_actor is null
     or not public.has_workspace_permission(p_workspace_id, 'clients.export') then
    raise exception 'audit_not_permitted' using errcode = '42501';
  end if;
  if p_mode is null or p_mode not in ('admin', 'data_subject_request')
     or p_include_internal_notes is null
     or p_counts is null or jsonb_typeof(p_counts) <> 'object' then
    raise exception 'invalid_input' using errcode = '22023';
  end if;
  if exists (select 1 from jsonb_each(p_counts) t(k, v)
              where jsonb_typeof(v) <> 'number' or k !~ '^[A-Za-z]{1,40}$') then
    raise exception 'invalid_input' using errcode = '22023';
  end if;
  if not exists (select 1 from public.clients c where c.id = p_client_id and c.workspace_id = p_workspace_id) then
    raise exception 'client_not_found' using errcode = 'P0002';
  end if;

  insert into public.audit_logs (workspace_id, actor_id, action, entity_type, entity_id, summary, source)
  values (p_workspace_id, v_actor, 'exported', 'client', p_client_id::text,
          left('Client data export generated (' || p_mode || ', internal notes '
               || case when p_include_internal_notes then 'included' else 'excluded' end || '): '
               || (select string_agg(k || ' ' || v, ', ' order by k) from jsonb_each_text(p_counts) t(k, v)), 500),
          'user');
end;
$$;
revoke all on function public.record_client_export_audit(uuid, uuid, text, boolean, jsonb) from public, anon, service_role;
grant execute on function public.record_client_export_audit(uuid, uuid, text, boolean, jsonb) to authenticated;

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
  -- Written by a narrow definer function (audit_logs has no insert privilege for
  -- signed-in users since this migration); the transaction-local flag makes the
  -- function usable only from this export, in the same transaction.
  perform set_config('serviceos.client_export_audit', 'on', true);
  perform public.record_client_export_audit(p_workspace_id, p_client_id, p_mode, p_include_internal_notes, v_counts);
  perform set_config('serviceos.client_export_audit', 'off', true);

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

-- 5. EXECUTE only where it is needed --------------------------------------------
-- Explicit list of application trigger functions (0006–0033). Supabase's default
-- privileges grant EXECUTE on new functions to anon / authenticated / service_role;
-- none of these is called through the API (see src/**: no rpc() on any of them).
revoke all on function public.after_invoice_item_change() from public, anon, authenticated, service_role;
revoke all on function public.after_payment_change() from public, anon, authenticated, service_role;
revoke all on function public.audit_data_subject_request() from public, anon, authenticated, service_role;
revoke all on function public.forget_client_in_inbox() from public, anon, authenticated, service_role;
revoke all on function public.guard_anonymized_client() from public, anon, authenticated, service_role;
revoke all on function public.guard_appointment_delete() from public, anon, authenticated, service_role;
revoke all on function public.guard_appointment_history() from public, anon, authenticated, service_role;
revoke all on function public.guard_client_archive() from public, anon, authenticated, service_role;
revoke all on function public.guard_data_subject_request() from public, anon, authenticated, service_role;
revoke all on function public.guard_external_calendar_refs() from public, anon, authenticated, service_role;
revoke all on function public.guard_inbox_event() from public, anon, authenticated, service_role;
revoke all on function public.guard_invoice_item_write() from public, anon, authenticated, service_role;
revoke all on function public.guard_invoice_references() from public, anon, authenticated, service_role;
revoke all on function public.guard_invoice_restrict_delete() from public, anon, authenticated, service_role;
revoke all on function public.guard_invoice_work_references() from public, anon, authenticated, service_role;
revoke all on function public.guard_invoice_write() from public, anon, authenticated, service_role;
revoke all on function public.guard_no_anonymized_client_ref() from public, anon, authenticated, service_role;
revoke all on function public.guard_no_archived_client_ref() from public, anon, authenticated, service_role;
revoke all on function public.guard_payment_write() from public, anon, authenticated, service_role;
revoke all on function public.guard_profile_update() from public, anon, authenticated, service_role;
revoke all on function public.guard_restrict_delete_with_appointments() from public, anon, authenticated, service_role;
revoke all on function public.guard_scheduling_references() from public, anon, authenticated, service_role;
revoke all on function public.guard_waiting_list() from public, anon, authenticated, service_role;
revoke all on function public.guard_work_references() from public, anon, authenticated, service_role;
revoke all on function public.guard_working_hours_integrity() from public, anon, authenticated, service_role;
revoke all on function public.guard_workspace_references() from public, anon, authenticated, service_role;
revoke all on function public.guard_workspace_retention_setting() from public, anon, authenticated, service_role;
revoke all on function public.guard_workspace_update() from public, anon, authenticated, service_role;
revoke all on function public.record_appointment_inbox_event() from public, anon, authenticated, service_role;
revoke all on function public.set_appointment_busy_range() from public, anon, authenticated, service_role;
revoke all on function public.audit_client_archive() from public, anon, authenticated, service_role;
revoke all on function public.audit_workspace_retention() from public, anon, authenticated, service_role;
