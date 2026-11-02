-- ServiceOS — 0031: client data retention period per workspace (settings).
--
-- Numbering: 0028 (anonymisation), 0029 (export) and 0030 (retention dry run)
-- are separate, not yet merged changes; apply them first (0028 -> 0029 -> 0030 -> 0031).
--
-- 1. workspaces.client_retention_months int, default 36, allowed 12..120.
--    These are PROVISIONAL TECHNICAL bounds, not legal requirements (Needs legal
--    review). Orientation only: the lower bound matches the provisional 12-month
--    Inbox period; the upper bound uses the 10-year retention that applies to
--    certain business records (e.g. § 147 AO) as a reference point — it does NOT
--    mean that client data must or may be kept that long. Neither GDPR nor § 147 AO
--    prescribes this range. The value is used ONLY to estimate (dry run); it
--    never deletes or anonymises anything.
-- 2. Permission retention.manage — owner only. The workspaces UPDATE policy lets
--    owner AND admin change settings (settings.manage), so a trigger refuses a
--    change of this column by anyone without retention.manage (also a direct API
--    call). The service role (no auth.uid()) is not restricted.
-- 3. retention_dry_run (0030) is redefined with the SAME signature and output, with
--    one change: the client cutoff is now per workspace
--    (now() - client_retention_months); p_client_cutoff stays as a fallback only.
--    Output gains clients.periodSource = 'workspace_setting'. Still counts only.
--
-- Additive: one column with a default, one permission row, one trigger; the dry-run
-- function is replaced in place (no data change).

alter table public.workspaces
  add column if not exists client_retention_months int not null default 36;

do $$
begin
  if not exists (select 1 from pg_constraint where conname = 'workspaces_client_retention_months_chk') then
    alter table public.workspaces
      add constraint workspaces_client_retention_months_chk check (client_retention_months between 12 and 120);
  end if;
end;
$$;

insert into public.role_permissions (role, permission) values ('owner', 'retention.manage')
on conflict do nothing;

create or replace function public.guard_workspace_retention_setting()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if new.client_retention_months is distinct from old.client_retention_months
     and (select auth.uid()) is not null
     and not public.has_workspace_permission(new.id, 'retention.manage') then
    raise exception 'retention_setting_not_permitted' using errcode = '42501';
  end if;
  return new;
end;
$$;
drop trigger if exists workspaces_guard_retention_setting on public.workspaces;
create trigger workspaces_guard_retention_setting
  before update of client_retention_months on public.workspaces
  for each row execute function public.guard_workspace_retention_setting();
revoke all on function public.guard_workspace_retention_setting() from public, anon, authenticated;

create or replace function public.retention_dry_run(p_client_cutoff timestamptz, p_inbox_cutoff timestamptz)
returns jsonb
language plpgsql
stable
security invoker
set search_path = ''
as $$
declare
  v_clients jsonb;
  v_inbox jsonb;
begin
  if p_client_cutoff is null or p_inbox_cutoff is null or p_client_cutoff > now() or p_inbox_cutoff > now() then
    raise exception 'invalid_cutoff' using errcode = '22023';
  end if;

  with c as (
    select cl.id, cl.workspace_id, cl.created_at,
           (to_jsonb(cl)->>'anonymized_at') is not null as anonymized,
           -- 0031: each workspace's own period; p_client_cutoff only if a workspace has none.
           coalesce(now() - make_interval(months => ws.client_retention_months), p_client_cutoff) as cutoff
      from public.clients cl
      join public.workspaces ws on ws.id = cl.workspace_id
  ), facts as (
    select c.*,
      (select max(a.starts_at) from public.appointments a
        where a.client_id = c.id and a.workspace_id = c.workspace_id and a.status = 'completed') as last_completed,
      exists (select 1 from public.appointments a
               where a.client_id = c.id and a.workspace_id = c.workspace_id and a.starts_at > now()
                 and a.status in ('pending', 'confirmed', 'checked_in', 'in_progress')) as b_future,
      exists (select 1 from public.appointments a
               where a.client_id = c.id and a.workspace_id = c.workspace_id and a.starts_at <= now()
                 and a.status in ('pending', 'confirmed', 'checked_in', 'in_progress')) as b_open_appointment,
      exists (select 1 from public.waiting_list w
               where w.client_id = c.id and w.workspace_id = c.workspace_id and w.status in ('waiting', 'contacted')) as b_waiting,
      (exists (select 1 from public.leads l where l.client_id = c.id and l.workspace_id = c.workspace_id
                 and not l.archived and l.stage not in ('won', 'lost'))
       or exists (select 1 from public.quotes q where q.client_id = c.id and q.workspace_id = c.workspace_id
                 and not q.archived and q.status in ('draft', 'sent'))
       or exists (select 1 from public.jobs j where j.client_id = c.id and j.workspace_id = c.workspace_id
                 and not j.archived and j.status in ('scheduled', 'inProgress'))
       or exists (select 1 from public.projects p where p.client_id = c.id and p.workspace_id = c.workspace_id
                 and not p.archived and p.status in ('active', 'onHold'))) as b_work,
      exists (select 1 from public.invoices i
               where i.client_id = c.id and i.workspace_id = c.workspace_id
                 and i.status::text in ('draft', 'sent', 'partially_paid', 'overdue')) as b_invoice
    from c
  ), classified as (
    select f.*,
           (f.b_future or f.b_open_appointment or f.b_waiting or f.b_work or f.b_invoice) as blocked
      from facts f
     where not f.anonymized
  )
  select jsonb_build_object(
    'total', (select count(*) from c),
    'alreadyAnonymized', (select count(*) from c where anonymized),
    'candidates', count(*) filter (where last_completed < cutoff and not blocked),
    'recentVisit', count(*) filter (where last_completed >= cutoff),
    'oldVisitButBlocked', count(*) filter (where last_completed < cutoff and blocked),
    'withoutCompletedVisitCreatedBeforeCutoff', count(*) filter (where last_completed is null and created_at < cutoff),
    'withoutCompletedVisitCreatedAfterCutoff', count(*) filter (where last_completed is null and created_at >= cutoff),
    'blockers', jsonb_build_object(
      'futureAppointment', count(*) filter (where b_future),
      'openAppointmentStatus', count(*) filter (where b_open_appointment),
      'activeWaitingList', count(*) filter (where b_waiting),
      'openWorkItem', count(*) filter (where b_work),
      'openInvoice', count(*) filter (where b_invoice)))
    into v_clients
    from classified;

  with stale as (
    select e.is_read,
           (e.entity_type = 'appointment' and exists (
              select 1 from public.appointments a
               where a.id::text = e.entity_id and a.workspace_id = e.workspace_id
                 and a.status in ('pending', 'confirmed', 'checked_in', 'in_progress'))) as open_process
      from public.inbox_events e
     where e.created_at < p_inbox_cutoff
  )
  select jsonb_build_object(
    'stale', count(*),
    'staleUnread', count(*) filter (where not is_read),
    'staleForOpenProcess', count(*) filter (where open_process),
    'staleEligible', count(*) filter (where not open_process))
    into v_inbox
    from stale;

  return jsonb_build_object('clients', v_clients || jsonb_build_object('periodSource', 'workspace_setting'),
                            'inboxEvents', v_inbox);
end;
$$;
revoke all on function public.retention_dry_run(timestamptz, timestamptz) from public, anon, authenticated;
grant execute on function public.retention_dry_run(timestamptz, timestamptz) to service_role;
