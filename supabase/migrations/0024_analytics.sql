-- ServiceOS — 0024: Analytics aggregates on real data (privacy-safe, SECURITY INVOKER)
-- Contract: docs/BUSINESS_OPERATIONS.md. Additive and replay-safe (create or replace function only; no table
-- is created, altered, dropped or deleted).
--
-- WHY SECURITY INVOKER (deliberately NOT definer)
--   analytics_overview() runs with the CALLER's rights, so Row Level Security of appointments, clients,
--   services, staff_profiles, invoices, payments, financial_buckets, leads, quotes, jobs and projects applies
--   to EVERY row it reads. An aggregate can therefore never reveal what the caller could not read directly:
--   private/owner_only appointments, private-bucket invoices and payments, private/owner_only work rows are
--   simply not part of the caller's totals. There is no second, hand-written privacy rule that could drift.
--   Only the explicit gates below are added on top (they decide which SECTIONS are returned at all):
--       appointments / services / staff workload : appointments.view
--       new clients, work pipeline               : clients.view     (same as the Work + Clients modules)
--       revenue, invoices, outstanding           : finance.view     (the keys are OMITTED without it)
--   A caller who is not a member of the workspace (or has none of the three) gets 'forbidden' (42501), the
--   same answer for a foreign and for a non-existing workspace id (no existence leak). anon cannot execute it.
--
-- DAY BOUNDARIES: p_from / p_to are inclusive calendar days in the WORKSPACE time zone (workspaces.timezone):
--   [p_from 00:00 local, (p_to + 1) 00:00 local). Never UTC, never the browser. An appointment belongs to the
--   day of its starts_at; a payment to the day of its paid_at; an invoice to its issued_at date; a new client
--   to the day of clients.created_at.
--
-- DEFINITIONS (documented, the UI shows exactly these)
--   appointments.by_status : all appointments starting in the range, one counter per appointment_status.
--   appointments.services  : top 10 services by number of appointments in the range, excluding cancelled and
--                            rescheduled ones (they never happened); deleted services show name null.
--   appointments.staff     : per staff member (inactive ones too, with their name) number of such appointments
--                            and booked minutes (ends_at - starts_at); staff_id null = unassigned.
--   clients.new            : clients created in the range.
--   work.*                 : SNAPSHOT of the current, non-archived pipeline (not limited to the range):
--                            leads by stage, quotes by status (+ value per currency), jobs by status (+ value
--                            per currency), projects by status.
--   finance.revenue        : REVENUE = sum of NON-VOIDED PAYMENTS (payments.voided_at is null) whose paid_at
--                            falls in the range (cash view: money actually received), per currency and per
--                            financial bucket kind (main / private / custom). A paid invoice's total is NOT
--                            used (an invoice paid in two instalments over two months counts in both).
--   finance.invoices       : invoices ISSUED in the range, per effective status (overdue is derived with the
--                            workspace-local today, see invoice_effective_status in 0022) and currency, with
--                            count and invoiced total.
--   finance.outstanding    : SNAPSHOT of open invoices (sent / partially paid, any issue date): open balance =
--                            invoice amount - non-voided payments, per currency, plus how many are overdue.
--   Money is summed as numeric (exact) and returned as TEXT decimals ("1234.50"); the app converts with the
--   shared integer helper (src/lib/money.ts). Currencies are never mixed: every money row carries its own.

create or replace function public.analytics_overview(p_workspace_id uuid, p_from date, p_to date)
returns jsonb
language plpgsql
stable
security invoker
set search_path = ''
as $$
declare
  v_tz text;
  v_today date;
  v_from_ts timestamptz;
  v_to_ts timestamptz;
  v_appts boolean;
  v_clients boolean;
  v_finance boolean;
  v_out jsonb;
  v_part jsonb;
  v_by_status jsonb;
  v_services jsonb;
  v_staff jsonb;
begin
  if p_workspace_id is null or p_from is null or p_to is null or p_from > p_to or p_to - p_from > 400 then
    raise exception 'invalid_input' using errcode = '22023';
  end if;

  v_appts := public.has_workspace_permission(p_workspace_id, 'appointments.view');
  v_clients := public.has_workspace_permission(p_workspace_id, 'clients.view');
  v_finance := public.has_workspace_permission(p_workspace_id, 'finance.view');
  if not (v_appts or v_clients or v_finance) then
    raise exception 'forbidden' using errcode = '42501';
  end if;

  select w.timezone into v_tz from public.workspaces w where w.id = p_workspace_id;
  if v_tz is null then
    raise exception 'forbidden' using errcode = '42501';
  end if;
  v_today := (now() at time zone v_tz)::date;
  v_from_ts := p_from::timestamp at time zone v_tz;
  v_to_ts := (p_to + 1)::timestamp at time zone v_tz;

  v_out := jsonb_build_object(
    'range', jsonb_build_object('from', p_from, 'to', p_to, 'timezone', v_tz, 'today', v_today),
    'permissions', jsonb_build_object('appointments', v_appts, 'clients', v_clients, 'finance', v_finance)
  );

  -- Appointments ---------------------------------------------------------------------------------------------
  if v_appts then
    select coalesce(jsonb_object_agg(s.v, coalesce(c.n, 0)), '{}'::jsonb) into v_by_status
    from (select unnest(enum_range(null::public.appointment_status))::text as v) s
    left join (
      select a.status::text as st, count(*)::int as n
      from public.appointments a
      where a.workspace_id = p_workspace_id and a.starts_at >= v_from_ts and a.starts_at < v_to_ts
      group by a.status
    ) c on c.st = s.v;

    select coalesce(jsonb_agg(jsonb_build_object('service_id', x.service_id, 'name', x.name, 'count', x.n)
                              order by x.n desc, x.name nulls last, x.service_id), '[]'::jsonb) into v_services
    from (
      select a.service_id, sv.name, count(*)::int as n
      from public.appointments a
      left join public.services sv on sv.id = a.service_id
      where a.workspace_id = p_workspace_id and a.starts_at >= v_from_ts and a.starts_at < v_to_ts
        and a.status not in ('cancelled', 'rescheduled')
      group by a.service_id, sv.name
      order by n desc, sv.name nulls last, a.service_id
      limit 10
    ) x;

    select coalesce(jsonb_agg(jsonb_build_object('staff_id', x.staff_id, 'name', x.name, 'active', x.active,
                                                 'count', x.n, 'minutes', x.minutes)
                              order by x.minutes desc, x.name nulls last, x.staff_id), '[]'::jsonb) into v_staff
    from (
      select a.staff_id, sp.name, sp.active, count(*)::int as n,
             coalesce(sum(extract(epoch from (a.ends_at - a.starts_at)) / 60), 0)::int as minutes
      from public.appointments a
      left join public.staff_profiles sp on sp.id = a.staff_id
      where a.workspace_id = p_workspace_id and a.starts_at >= v_from_ts and a.starts_at < v_to_ts
        and a.status not in ('cancelled', 'rescheduled')
      group by a.staff_id, sp.name, sp.active
    ) x;

    v_out := v_out || jsonb_build_object('appointments', jsonb_build_object(
      'total', (select coalesce(sum(value::int), 0) from jsonb_each_text(v_by_status)),
      'by_status', v_by_status,
      'services', v_services,
      'staff', v_staff
    ));
  end if;

  -- Clients + work pipeline (clients.view) ---------------------------------------------------------------------
  if v_clients then
    v_out := v_out || jsonb_build_object('clients', jsonb_build_object('new', (
      select count(*)::int from public.clients c
      where c.workspace_id = p_workspace_id and c.created_at >= v_from_ts and c.created_at < v_to_ts
    )));

    v_out := v_out || jsonb_build_object('work', jsonb_build_object(
      'leads', (select coalesce(jsonb_agg(jsonb_build_object('stage', x.stage, 'count', x.n) order by x.stage), '[]'::jsonb)
                from (select l.stage, count(*)::int as n from public.leads l
                      where l.workspace_id = p_workspace_id and not l.archived group by l.stage) x),
      'quotes', (select coalesce(jsonb_agg(jsonb_build_object('status', x.status, 'currency', x.currency, 'count', x.n,
                                                              'total', x.total::text) order by x.status, x.currency), '[]'::jsonb)
                 from (select q.status, q.currency, count(*)::int as n, sum(q.amount) as total from public.quotes q
                       where q.workspace_id = p_workspace_id and not q.archived group by q.status, q.currency) x),
      'jobs', (select coalesce(jsonb_agg(jsonb_build_object('status', x.status, 'currency', x.currency, 'count', x.n,
                                                            'total', x.total::text) order by x.status, x.currency), '[]'::jsonb)
               from (select j.status, j.currency, count(*)::int as n, sum(j.amount) as total from public.jobs j
                     where j.workspace_id = p_workspace_id and not j.archived group by j.status, j.currency) x),
      'projects', (select coalesce(jsonb_agg(jsonb_build_object('status', x.status, 'count', x.n) order by x.status), '[]'::jsonb)
                   from (select p.status, count(*)::int as n from public.projects p
                         where p.workspace_id = p_workspace_id and not p.archived group by p.status) x)
    ));
  end if;

  -- Finance (finance.view) -------------------------------------------------------------------------------------
  if v_finance then
    select jsonb_build_object(
      'revenue', (
        select coalesce(jsonb_agg(jsonb_build_object('currency', x.currency, 'bucket', x.bucket, 'total', x.total::text,
                                                     'payments', x.n) order by x.currency, x.bucket), '[]'::jsonb)
        from (
          select p.currency, coalesce(b.kind, 'main') as bucket, sum(p.amount) as total, count(*)::int as n
          from public.payments p
          join public.invoices i on i.id = p.invoice_id
          left join public.financial_buckets b on b.id = i.financial_bucket_id
          where p.workspace_id = p_workspace_id and p.voided_at is null
            and p.paid_at >= v_from_ts and p.paid_at < v_to_ts
          group by p.currency, coalesce(b.kind, 'main')
        ) x),
      'invoices', (
        select coalesce(jsonb_agg(jsonb_build_object('status', x.status, 'currency', x.currency, 'count', x.n,
                                                     'total', x.total::text) order by x.status, x.currency), '[]'::jsonb)
        from (
          select public.invoice_effective_status(i.status, i.due_at, v_today)::text as status, i.currency,
                 count(*)::int as n, sum(i.amount) as total
          from public.invoices i
          where i.workspace_id = p_workspace_id and i.issued_at between p_from and p_to
          group by public.invoice_effective_status(i.status, i.due_at, v_today), i.currency
        ) x),
      'outstanding', (
        select coalesce(jsonb_agg(jsonb_build_object('currency', x.currency, 'total', x.total::text, 'invoices', x.n,
                                                     'overdue', x.overdue) order by x.currency), '[]'::jsonb)
        from (
          select i.currency,
                 sum(i.amount - coalesce(pd.paid, 0)) as total,
                 count(*)::int as n,
                 count(*) filter (where i.due_at is not null and i.due_at < v_today)::int as overdue
          from public.invoices i
          left join lateral (
            select sum(p.amount) as paid from public.payments p where p.invoice_id = i.id and p.voided_at is null
          ) pd on true
          where i.workspace_id = p_workspace_id and i.status in ('sent', 'partially_paid')
          group by i.currency
        ) x)
    ) into v_part;
    v_out := v_out || jsonb_build_object('finance', v_part);
  end if;

  return v_out;
end;
$$;

revoke all on function public.analytics_overview(uuid, date, date) from public, anon;
grant execute on function public.analytics_overview(uuid, date, date) to authenticated, service_role;
