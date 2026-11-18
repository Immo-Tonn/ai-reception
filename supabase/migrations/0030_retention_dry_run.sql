-- ServiceOS — 0030: retention dry-run (COUNTS ONLY, changes nothing).
--
-- Numbering: 0028 (client anonymisation) and 0029 (client data export) are
-- separate, not yet merged changes; apply them first. This function works with
-- and without 0028: the anonymisation marker is read via to_jsonb(), so a missing
-- column simply means "nobody is anonymised yet".
--
-- retention_dry_run(client_cutoff, inbox_cutoff) — called by the daily cron with
-- the service role only. Returns aggregated numbers for all workspaces; no ids,
-- names or contents. Periods are PROVISIONAL (Needs legal review) and passed in
-- by the caller (36 months for clients, 12 months for Inbox notifications).
--
-- Clients:
--   candidates          last COMPLETED visit before the cutoff and no blocker
--   recentVisit         completed visit after the cutoff (not a candidate)
--   withoutCompletedVisit  never had a completed visit — reported separately,
--                       split into created before / after the cutoff; never a candidate here
--   blockers (a client may have several): future appointment, open past
--     appointment status, active waiting-list entry, open lead / quote / job /
--     project, open invoice (draft / sent / partially paid / overdue). A paid or
--     cancelled invoice is NOT a blocker (it is kept itself, category C).
--   alreadyAnonymized   0028 marker set
-- Inbox notifications (inbox_events):
--   stale               older than the cutoff
--   staleUnread         of those, still unread
--   staleForOpenProcess of those, about an appointment that is still upcoming / open
--   staleEligible       stale and not tied to an open process
--
-- Additive: one function. No table, row or policy is changed.

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
           (to_jsonb(cl)->>'anonymized_at') is not null as anonymized
      from public.clients cl
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
    'candidates', count(*) filter (where last_completed < p_client_cutoff and not blocked),
    'recentVisit', count(*) filter (where last_completed >= p_client_cutoff),
    'oldVisitButBlocked', count(*) filter (where last_completed < p_client_cutoff and blocked),
    'withoutCompletedVisitCreatedBeforeCutoff', count(*) filter (where last_completed is null and created_at < p_client_cutoff),
    'withoutCompletedVisitCreatedAfterCutoff', count(*) filter (where last_completed is null and created_at >= p_client_cutoff),
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

  return jsonb_build_object('clients', v_clients, 'inboxEvents', v_inbox);
end;
$$;
revoke all on function public.retention_dry_run(timestamptz, timestamptz) from public, anon, authenticated;
grant execute on function public.retention_dry_run(timestamptz, timestamptz) to service_role;
