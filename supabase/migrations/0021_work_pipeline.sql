-- ServiceOS — 0021: Work pipeline on the shared backend (leads, quotes, jobs, projects)
-- Contract: docs/BUSINESS_OPERATIONS.md (Lead -> Quote -> accepted -> Job and/or Project -> Invoice).
--
-- WHAT THIS ADDS (additive; nothing is dropped, renamed or deleted)
--   leads, quotes, quote_items, jobs, projects  : each row carries TWO independent axes
--       visibility (appointment_visibility enum, reused) and financial_bucket_id (FK financial_buckets);
--       never merged into one flag. client_id is a nullable FK to clients; client_name is a free-text
--       snapshot for prospects that are not clients yet.
--   invoices                                    : nullable quote_id / job_id / project_id (ON DELETE SET NULL)
--       = the Work <-> Finance relation (same-workspace guard).
--   can_see_work_row()                          : privacy helper = can_see_appointment() (0012) AND
--       "a PRIVATE financial bucket needs financial_bucket.private.view".
--   RLS (split per command)                     : read clients.view, write clients.edit (+ the privacy helper
--       on the row, also WITH CHECK so nobody can write a row they could not see). No DELETE policy and no
--       DELETE grant: work is archived (archived = true), never deleted; FKs between work rows are NO ACTION.
--   Conversions (SECURITY INVOKER, so RLS applies; atomic; IDEMPOTENT: a second call returns the existing
--       result, a unique index is the backstop):
--       convert_lead_to_quote, accept_quote_create_job, create_project_for_job, attach_job_to_project,
--       replace_quote_items.  Invalid transitions raise errcode 22023 with a short code as message.
--
-- Replay-safe: every statement is idempotent.

-- ---------------------------------------------------------------------------
-- 1. Privacy helper
-- ---------------------------------------------------------------------------
create or replace function public.can_see_work_row(
  p_workspace_id uuid, p_visibility public.appointment_visibility, p_bucket_id uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select public.can_see_appointment(p_workspace_id, p_visibility)
     and (
       p_bucket_id is null
       or not exists (select 1 from public.financial_buckets b
                      where b.id = p_bucket_id and b.workspace_id = p_workspace_id and b.kind = 'private')
       or public.has_workspace_permission(p_workspace_id, 'financial_bucket.private.view')
     );
$$;
revoke all on function public.can_see_work_row(uuid, public.appointment_visibility, uuid) from public, anon;
grant execute on function public.can_see_work_row(uuid, public.appointment_visibility, uuid) to authenticated, service_role;

-- ---------------------------------------------------------------------------
-- 2. Tables
-- ---------------------------------------------------------------------------
create table if not exists public.leads (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references public.workspaces(id) on delete cascade,
  client_id uuid references public.clients(id) on delete no action,
  client_name text not null default '' check (char_length(client_name) <= 200),
  title text not null check (char_length(btrim(title)) between 1 and 200),
  notes text not null default '' check (char_length(notes) <= 4000),
  stage text not null default 'new' check (stage in ('new', 'contacted', 'quoted', 'won', 'lost')),
  source text not null default '' check (char_length(source) <= 100),
  estimated_value numeric(12, 2) check (estimated_value is null or estimated_value >= 0),
  currency text not null default 'EUR' check (char_length(currency) = 3),
  visibility public.appointment_visibility not null default 'normal',
  financial_bucket_id uuid references public.financial_buckets(id) on delete no action,
  archived boolean not null default false,
  created_by uuid references public.profiles(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.quotes (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references public.workspaces(id) on delete cascade,
  client_id uuid references public.clients(id) on delete no action,
  client_name text not null default '' check (char_length(client_name) <= 200),
  lead_id uuid references public.leads(id) on delete no action,
  title text not null check (char_length(btrim(title)) between 1 and 200),
  notes text not null default '' check (char_length(notes) <= 4000),
  status text not null default 'draft' check (status in ('draft', 'sent', 'accepted', 'declined')),
  amount numeric(12, 2) not null default 0 check (amount >= 0),
  currency text not null default 'EUR' check (char_length(currency) = 3),
  valid_until date,
  visibility public.appointment_visibility not null default 'normal',
  financial_bucket_id uuid references public.financial_buckets(id) on delete no action,
  archived boolean not null default false,
  created_by uuid references public.profiles(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.quote_items (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references public.workspaces(id) on delete cascade,
  quote_id uuid not null references public.quotes(id) on delete cascade,
  position int not null default 0,
  description text not null check (char_length(btrim(description)) between 1 and 300),
  quantity numeric(10, 2) not null default 1 check (quantity > 0),
  unit_price numeric(12, 2) not null default 0 check (unit_price >= 0),
  line_total numeric(12, 2) generated always as (round(quantity * unit_price, 2)) stored,
  created_at timestamptz not null default now()
);

create table if not exists public.projects (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references public.workspaces(id) on delete cascade,
  client_id uuid references public.clients(id) on delete no action,
  client_name text not null default '' check (char_length(client_name) <= 200),
  title text not null check (char_length(btrim(title)) between 1 and 200),
  notes text not null default '' check (char_length(notes) <= 4000),
  status text not null default 'active' check (status in ('active', 'onHold', 'done')),
  starts_on date,
  ends_on date,
  visibility public.appointment_visibility not null default 'normal',
  financial_bucket_id uuid references public.financial_buckets(id) on delete no action,
  archived boolean not null default false,
  created_by uuid references public.profiles(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint projects_dates_chk check (starts_on is null or ends_on is null or ends_on >= starts_on)
);

create table if not exists public.jobs (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references public.workspaces(id) on delete cascade,
  client_id uuid references public.clients(id) on delete no action,
  client_name text not null default '' check (char_length(client_name) <= 200),
  quote_id uuid references public.quotes(id) on delete no action,
  project_id uuid references public.projects(id) on delete no action,
  title text not null check (char_length(btrim(title)) between 1 and 200),
  notes text not null default '' check (char_length(notes) <= 4000),
  status text not null default 'scheduled' check (status in ('scheduled', 'inProgress', 'done', 'invoiced', 'cancelled')),
  amount numeric(12, 2) not null default 0 check (amount >= 0),
  currency text not null default 'EUR' check (char_length(currency) = 3),
  responsible_staff_id uuid references public.staff_profiles(id) on delete no action,
  starts_on date,
  due_on date,
  visibility public.appointment_visibility not null default 'normal',
  financial_bucket_id uuid references public.financial_buckets(id) on delete no action,
  archived boolean not null default false,
  created_by uuid references public.profiles(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint jobs_dates_chk check (starts_on is null or due_on is null or due_on >= starts_on)
);

-- One quote per lead and one job per quote: the idempotency backstop of the conversions.
create unique index if not exists uq_quotes_lead on public.quotes (lead_id) where lead_id is not null;
create unique index if not exists uq_jobs_quote on public.jobs (quote_id) where quote_id is not null;

create index if not exists idx_leads_workspace on public.leads (workspace_id, archived, created_at desc);
create index if not exists idx_leads_client on public.leads (client_id) where client_id is not null;
create index if not exists idx_quotes_workspace on public.quotes (workspace_id, archived, created_at desc);
create index if not exists idx_quotes_client on public.quotes (client_id) where client_id is not null;
create index if not exists idx_quote_items_quote on public.quote_items (quote_id, position);
create index if not exists idx_jobs_workspace on public.jobs (workspace_id, archived, created_at desc);
create index if not exists idx_jobs_client on public.jobs (client_id) where client_id is not null;
create index if not exists idx_jobs_project on public.jobs (project_id) where project_id is not null;
create index if not exists idx_jobs_staff on public.jobs (responsible_staff_id) where responsible_staff_id is not null;
create index if not exists idx_projects_workspace on public.projects (workspace_id, archived, created_at desc);
create index if not exists idx_projects_client on public.projects (client_id) where client_id is not null;

-- ---------------------------------------------------------------------------
-- 3. Work <-> Finance relation on the existing invoices table
-- ---------------------------------------------------------------------------
alter table public.invoices
  add column if not exists quote_id uuid references public.quotes(id) on delete set null,
  add column if not exists job_id uuid references public.jobs(id) on delete set null,
  add column if not exists project_id uuid references public.projects(id) on delete set null;
create index if not exists idx_invoices_quote on public.invoices (quote_id) where quote_id is not null;
create index if not exists idx_invoices_job on public.invoices (job_id) where job_id is not null;
create index if not exists idx_invoices_project on public.invoices (project_id) where project_id is not null;

-- ---------------------------------------------------------------------------
-- 4. Guards: same-workspace references, default bucket, updated_at, transitions
-- ---------------------------------------------------------------------------
create or replace function public.guard_work_references()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_bucket uuid;
begin
  if tg_op = 'UPDATE' and new.workspace_id is distinct from old.workspace_id then
    raise exception 'cross_workspace_reference' using errcode = '23514';
  end if;

  if tg_table_name = 'quote_items' then
    if not exists (select 1 from public.quotes q where q.id = new.quote_id and q.workspace_id = new.workspace_id) then
      raise exception 'cross_workspace_reference' using errcode = '23514';
    end if;
    return new;
  end if;

  if (new.client_id is not null and not exists (
        select 1 from public.clients x where x.id = new.client_id and x.workspace_id = new.workspace_id))
     or (new.financial_bucket_id is not null and not exists (
        select 1 from public.financial_buckets x where x.id = new.financial_bucket_id and x.workspace_id = new.workspace_id)) then
    raise exception 'cross_workspace_reference' using errcode = '23514';
  end if;

  if tg_table_name = 'quotes' then
    if new.lead_id is not null and not exists (
         select 1 from public.leads x where x.id = new.lead_id and x.workspace_id = new.workspace_id) then
      raise exception 'cross_workspace_reference' using errcode = '23514';
    end if;
    -- A declined quote cannot jump to accepted; re-open it (draft / sent) first. An accepted quote that
    -- already produced a job cannot be taken back.
    if tg_op = 'UPDATE' and new.status is distinct from old.status then
      if old.status = 'declined' and new.status = 'accepted' then
        raise exception 'quote_declined' using errcode = '22023';
      end if;
      if old.status = 'accepted' and new.status in ('draft', 'sent', 'declined')
         and exists (select 1 from public.jobs j where j.quote_id = old.id) then
        raise exception 'quote_has_job' using errcode = '22023';
      end if;
    end if;
  elsif tg_table_name = 'jobs' then
    if (new.quote_id is not null and not exists (
          select 1 from public.quotes x where x.id = new.quote_id and x.workspace_id = new.workspace_id))
       or (new.project_id is not null and not exists (
          select 1 from public.projects x where x.id = new.project_id and x.workspace_id = new.workspace_id))
       or (new.responsible_staff_id is not null and not exists (
          select 1 from public.staff_profiles x where x.id = new.responsible_staff_id and x.workspace_id = new.workspace_id)) then
      raise exception 'cross_workspace_reference' using errcode = '23514';
    end if;
  end if;

  if tg_op = 'INSERT' and new.financial_bucket_id is null then
    select b.id into v_bucket from public.financial_buckets b
     where b.workspace_id = new.workspace_id and b.kind = 'main' and not b.is_archived
     order by b.is_default desc, b.created_at limit 1;
    new.financial_bucket_id := v_bucket;
  end if;
  if tg_op = 'UPDATE' then
    new.updated_at := now();
  end if;
  return new;
end;
$$;

create or replace function public.guard_invoice_work_references()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if (new.quote_id is not null and not exists (
        select 1 from public.quotes x where x.id = new.quote_id and x.workspace_id = new.workspace_id))
     or (new.job_id is not null and not exists (
        select 1 from public.jobs x where x.id = new.job_id and x.workspace_id = new.workspace_id))
     or (new.project_id is not null and not exists (
        select 1 from public.projects x where x.id = new.project_id and x.workspace_id = new.workspace_id)) then
    raise exception 'cross_workspace_reference' using errcode = '23514';
  end if;
  return new;
end;
$$;

drop trigger if exists leads_guard_refs on public.leads;
create trigger leads_guard_refs before insert or update on public.leads
  for each row execute function public.guard_work_references();
drop trigger if exists quotes_guard_refs on public.quotes;
create trigger quotes_guard_refs before insert or update on public.quotes
  for each row execute function public.guard_work_references();
drop trigger if exists quote_items_guard_refs on public.quote_items;
create trigger quote_items_guard_refs before insert or update on public.quote_items
  for each row execute function public.guard_work_references();
drop trigger if exists jobs_guard_refs on public.jobs;
create trigger jobs_guard_refs before insert or update on public.jobs
  for each row execute function public.guard_work_references();
drop trigger if exists projects_guard_refs on public.projects;
create trigger projects_guard_refs before insert or update on public.projects
  for each row execute function public.guard_work_references();
drop trigger if exists invoices_work_refs_guard on public.invoices;
create trigger invoices_work_refs_guard before insert or update on public.invoices
  for each row execute function public.guard_invoice_work_references();

revoke all on function public.guard_work_references() from public, anon, authenticated;
revoke all on function public.guard_invoice_work_references() from public, anon, authenticated;

-- ---------------------------------------------------------------------------
-- 5. RLS
-- ---------------------------------------------------------------------------
alter table public.leads enable row level security;
alter table public.quotes enable row level security;
alter table public.quote_items enable row level security;
alter table public.jobs enable row level security;
alter table public.projects enable row level security;

do $$
declare
  t text;
begin
  foreach t in array array['leads', 'quotes', 'jobs', 'projects'] loop
    execute format('drop policy if exists %I on public.%I', t || '_select', t);
    execute format($p$create policy %I on public.%I for select to authenticated
      using (public.has_workspace_permission(workspace_id, 'clients.view')
             and public.can_see_work_row(workspace_id, visibility, financial_bucket_id))$p$, t || '_select', t);

    execute format('drop policy if exists %I on public.%I', t || '_insert', t);
    execute format($p$create policy %I on public.%I for insert to authenticated
      with check (public.has_workspace_permission(workspace_id, 'clients.edit')
                  and public.can_see_work_row(workspace_id, visibility, financial_bucket_id)
                  and created_by is not distinct from (select auth.uid()))$p$, t || '_insert', t);

    execute format('drop policy if exists %I on public.%I', t || '_update', t);
    execute format($p$create policy %I on public.%I for update to authenticated
      using (public.has_workspace_permission(workspace_id, 'clients.edit')
             and public.can_see_work_row(workspace_id, visibility, financial_bucket_id))
      with check (public.has_workspace_permission(workspace_id, 'clients.edit')
                  and public.can_see_work_row(workspace_id, visibility, financial_bucket_id))$p$, t || '_update', t);
  end loop;
end
$$;

-- quote_items follow their quote: the sub-select runs under the caller's RLS, so a quote the caller
-- cannot see (owner-only, private bucket) has invisible items too.
drop policy if exists quote_items_select on public.quote_items;
create policy quote_items_select on public.quote_items for select to authenticated
  using (public.has_workspace_permission(workspace_id, 'clients.view')
         and exists (select 1 from public.quotes q where q.id = quote_items.quote_id));
drop policy if exists quote_items_insert on public.quote_items;
create policy quote_items_insert on public.quote_items for insert to authenticated
  with check (public.has_workspace_permission(workspace_id, 'clients.edit')
              and exists (select 1 from public.quotes q where q.id = quote_items.quote_id));
drop policy if exists quote_items_update on public.quote_items;
create policy quote_items_update on public.quote_items for update to authenticated
  using (public.has_workspace_permission(workspace_id, 'clients.edit')
         and exists (select 1 from public.quotes q where q.id = quote_items.quote_id))
  with check (public.has_workspace_permission(workspace_id, 'clients.edit')
              and exists (select 1 from public.quotes q where q.id = quote_items.quote_id));
drop policy if exists quote_items_delete on public.quote_items;
create policy quote_items_delete on public.quote_items for delete to authenticated
  using (public.has_workspace_permission(workspace_id, 'clients.edit')
         and exists (select 1 from public.quotes q where q.id = quote_items.quote_id));

revoke all on public.leads, public.quotes, public.quote_items, public.jobs, public.projects from anon;
revoke all on public.leads, public.quotes, public.quote_items, public.jobs, public.projects from authenticated;
grant select, insert, update on public.leads, public.quotes, public.jobs, public.projects to authenticated;
grant select, insert, update, delete on public.quote_items to authenticated;
grant all on public.leads, public.quotes, public.quote_items, public.jobs, public.projects to service_role;

-- ---------------------------------------------------------------------------
-- 6. Conversions (SECURITY INVOKER: RLS applies to every read and write below)
-- ---------------------------------------------------------------------------
create or replace function public.convert_lead_to_quote(
  p_lead_id uuid,
  p_visibility public.appointment_visibility default null,
  p_financial_bucket_id uuid default null)
returns table (out_quote_id uuid, out_created boolean)
language plpgsql
set search_path = ''
as $$
declare
  v_lead public.leads%rowtype;
  v_quote_id uuid;
begin
  select * into v_lead from public.leads l where l.id = p_lead_id for update;
  if not found then raise exception 'not_found' using errcode = 'P0002'; end if;

  select q.id into v_quote_id from public.quotes q where q.lead_id = v_lead.id limit 1;
  if v_quote_id is not null then
    return query select v_quote_id, false;
    return;
  end if;

  if v_lead.stage = 'lost' then raise exception 'lead_lost' using errcode = '22023'; end if;
  if v_lead.archived then raise exception 'archived' using errcode = '22023'; end if;

  insert into public.quotes (workspace_id, client_id, client_name, lead_id, title, notes, status, amount, currency,
                             visibility, financial_bucket_id, created_by)
  values (v_lead.workspace_id, v_lead.client_id, v_lead.client_name, v_lead.id, v_lead.title, v_lead.notes, 'draft',
          coalesce(v_lead.estimated_value, 0), v_lead.currency,
          coalesce(p_visibility, v_lead.visibility),
          coalesce(p_financial_bucket_id, v_lead.financial_bucket_id),
          (select auth.uid()))
  returning id into v_quote_id;

  update public.leads set stage = 'quoted' where id = v_lead.id;
  return query select v_quote_id, true;
end;
$$;

create or replace function public.accept_quote_create_job(
  p_quote_id uuid,
  p_project_id uuid default null,
  p_visibility public.appointment_visibility default null,
  p_financial_bucket_id uuid default null)
returns table (out_job_id uuid, out_created boolean)
language plpgsql
set search_path = ''
as $$
declare
  v_quote public.quotes%rowtype;
  v_job public.jobs%rowtype;
  v_project_client uuid;
  v_project_found boolean := false;
begin
  select * into v_quote from public.quotes q where q.id = p_quote_id for update;
  if not found then raise exception 'not_found' using errcode = 'P0002'; end if;

  if p_project_id is not null then
    select p.client_id, true into v_project_client, v_project_found from public.projects p where p.id = p_project_id;
    if not v_project_found then raise exception 'not_found' using errcode = 'P0002'; end if;
    if v_project_client is not null and v_quote.client_id is not null and v_project_client <> v_quote.client_id then
      raise exception 'client_mismatch' using errcode = '22023';
    end if;
  end if;

  select * into v_job from public.jobs j where j.quote_id = v_quote.id limit 1;
  if found then
    if p_project_id is not null and v_job.project_id is null then
      update public.jobs set project_id = p_project_id where id = v_job.id;
    end if;
    if v_quote.status <> 'accepted' then
      update public.quotes set status = 'accepted' where id = v_quote.id;
    end if;
    return query select v_job.id, false;
    return;
  end if;

  if v_quote.status = 'declined' then raise exception 'quote_declined' using errcode = '22023'; end if;
  if v_quote.archived then raise exception 'archived' using errcode = '22023'; end if;

  if v_quote.status <> 'accepted' then
    update public.quotes set status = 'accepted' where id = v_quote.id;
  end if;

  insert into public.jobs (workspace_id, client_id, client_name, quote_id, project_id, title, notes, status, amount,
                           currency, visibility, financial_bucket_id, created_by)
  values (v_quote.workspace_id, v_quote.client_id, v_quote.client_name, v_quote.id, p_project_id, v_quote.title,
          v_quote.notes, 'scheduled', v_quote.amount, v_quote.currency,
          coalesce(p_visibility, v_quote.visibility),
          coalesce(p_financial_bucket_id, v_quote.financial_bucket_id),
          (select auth.uid()))
  returning * into v_job;

  if v_quote.lead_id is not null then
    update public.leads set stage = 'won' where id = v_quote.lead_id and stage <> 'won';
  end if;
  return query select v_job.id, true;
end;
$$;

create or replace function public.create_project_for_job(p_job_id uuid)
returns table (out_project_id uuid, out_created boolean)
language plpgsql
set search_path = ''
as $$
declare
  v_job public.jobs%rowtype;
  v_project_id uuid;
begin
  select * into v_job from public.jobs j where j.id = p_job_id for update;
  if not found then raise exception 'not_found' using errcode = 'P0002'; end if;
  if v_job.project_id is not null then
    return query select v_job.project_id, false;
    return;
  end if;
  if v_job.archived then raise exception 'archived' using errcode = '22023'; end if;

  insert into public.projects (workspace_id, client_id, client_name, title, notes, status, visibility, financial_bucket_id, created_by)
  values (v_job.workspace_id, v_job.client_id, v_job.client_name, v_job.title, v_job.notes, 'active',
          v_job.visibility, v_job.financial_bucket_id, (select auth.uid()))
  returning id into v_project_id;
  update public.jobs set project_id = v_project_id where id = v_job.id;
  return query select v_project_id, true;
end;
$$;

create or replace function public.attach_job_to_project(p_job_id uuid, p_project_id uuid)
returns uuid
language plpgsql
set search_path = ''
as $$
declare
  v_job public.jobs%rowtype;
  v_project public.projects%rowtype;
begin
  select * into v_job from public.jobs j where j.id = p_job_id for update;
  if not found then raise exception 'not_found' using errcode = 'P0002'; end if;
  select * into v_project from public.projects p where p.id = p_project_id;
  if not found then raise exception 'not_found' using errcode = 'P0002'; end if;
  if v_project.client_id is not null and v_job.client_id is not null and v_project.client_id <> v_job.client_id then
    raise exception 'client_mismatch' using errcode = '22023';
  end if;
  if v_job.project_id is distinct from v_project.id then
    update public.jobs set project_id = v_project.id where id = v_job.id;
  end if;
  return v_job.id;
end;
$$;

-- Replaces all line items of a quote atomically and recomputes the total in exact decimal arithmetic.
create or replace function public.replace_quote_items(p_quote_id uuid, p_items jsonb)
returns numeric
language plpgsql
set search_path = ''
as $$
declare
  v_quote public.quotes%rowtype;
  v_total numeric(12, 2);
begin
  select * into v_quote from public.quotes q where q.id = p_quote_id for update;
  if not found then raise exception 'not_found' using errcode = 'P0002'; end if;
  if v_quote.status = 'accepted' or v_quote.archived then raise exception 'quote_locked' using errcode = '22023'; end if;
  if p_items is null or jsonb_typeof(p_items) <> 'array' then raise exception 'invalid_input' using errcode = '22023'; end if;

  delete from public.quote_items where quote_id = v_quote.id;
  insert into public.quote_items (workspace_id, quote_id, position, description, quantity, unit_price)
  select v_quote.workspace_id, v_quote.id, (e.ord - 1)::int,
         e.value ->> 'description',
         coalesce((e.value ->> 'quantity')::numeric, 1),
         coalesce((e.value ->> 'unit_price')::numeric, 0)
  from jsonb_array_elements(p_items) with ordinality as e(value, ord);

  select coalesce(sum(i.line_total), 0) into v_total from public.quote_items i where i.quote_id = v_quote.id;
  update public.quotes set amount = v_total where id = v_quote.id;
  return v_total;
end;
$$;

revoke all on function public.convert_lead_to_quote(uuid, public.appointment_visibility, uuid) from public, anon;
revoke all on function public.accept_quote_create_job(uuid, uuid, public.appointment_visibility, uuid) from public, anon;
revoke all on function public.create_project_for_job(uuid) from public, anon;
revoke all on function public.attach_job_to_project(uuid, uuid) from public, anon;
revoke all on function public.replace_quote_items(uuid, jsonb) from public, anon;
grant execute on function public.convert_lead_to_quote(uuid, public.appointment_visibility, uuid) to authenticated, service_role;
grant execute on function public.accept_quote_create_job(uuid, uuid, public.appointment_visibility, uuid) to authenticated, service_role;
grant execute on function public.create_project_for_job(uuid) to authenticated, service_role;
grant execute on function public.attach_job_to_project(uuid, uuid) to authenticated, service_role;
grant execute on function public.replace_quote_items(uuid, jsonb) to authenticated, service_role;
