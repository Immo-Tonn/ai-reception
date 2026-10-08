-- ServiceOS — 0022: Finance — invoices, line items, payments, numbering (real backend)
--
-- Additive and replay-safe (no drop table / truncate / delete of data). Reuses 0005 tables and the
-- 0012 privacy helpers. Agent B's 0021 adds invoices.job_id / project_id / quote_id itself; nothing
-- here depends on them.
--
-- ONE SOURCE OF TRUTH
--   * invoices.amount is DERIVED: sum(round(quantity * unit_price, 2)) of the invoice's items. Triggers
--     recompute it after every item change and a BEFORE UPDATE guard overwrites any attempt to write it
--     directly, so amount and items can never disagree.
--   * invoices.status is kept consistent with the payments table by the same machinery: paid /
--     partially_paid follow the sum of NON-voided payments. Direct status writes that contradict the
--     payments are refused.
--
-- STATUS MAPPING (domain/UI <-> invoice_status enum; the enum is NOT changed, no ADD VALUE needed)
--     domain "draft"      <-> draft
--     domain "unpaid"     <-> sent            (issued, nothing paid; the legacy UI word)
--     domain "partial"    <-> partially_paid  (some payments, balance > 0)
--     domain "paid"       <-> paid
--     domain "cancelled"  <-> void            (final, locked)
--     domain "overdue"    :   DERIVED at read time = (sent | partially_paid) and due_at < today
--                              (workspace-local day). invoice_effective_status() does it in SQL; the
--                              TS mapper does it for the app. No cron, no stored 'overdue'.
--
-- NUMBERING: invoice_counters(workspace_id, year) is bumped with INSERT .. ON CONFLICT DO UPDATE inside
-- next_invoice_number(), which row-locks the counter, so concurrent creates serialise and can never
-- get the same number; the surrounding transaction (create_invoice) rolls the counter back on failure
-- (gapless). Format INV-{workspace-local year}-{0001}. UNIQUE (workspace_id, number) from 0005 stays the
-- last line of defence.
--
-- create_invoice() is SECURITY INVOKER (decision): every insert it makes goes through the normal RLS
-- policies of invoices / invoice_items, so permissions (finance.edit, bucket, visibility) are enforced by
-- exactly the same rules as a direct insert and cannot drift from a hand-written check. Only the pieces
-- that must bypass RLS are SECURITY DEFINER with explicit checks: next_invoice_number (finance.edit
-- required; the counter table has no policy), the guard/recompute triggers (act only on the referenced
-- invoice) and the 0012 helpers. search_path is pinned to '' everywhere.
--
-- PRIVACY: an invoice (and its items and payments) is visible only if the caller has finance.view AND may
-- use its bucket (PRIVATE bucket -> financial_bucket.private.view, otherwise ...main.view) AND may see its
-- visibility (private/custom -> private_records.view, owner_only -> owner_records.view). Items and
-- payments are resolved through the parent invoice. Policies are split per command (0016 lesson).
--
-- HISTORY: invoices and payments are never deleted (restrict-delete trigger; a workspace cascade is let
-- through). Cancel an invoice (status void) or void a payment (voided_at) instead.

-- 1. Columns / constraints ------------------------------------------------------------------------------
alter table public.invoices add column if not exists notes text not null default '';
alter table public.invoices add column if not exists client_name text not null default '';
alter table public.invoices alter column amount type numeric(12, 2);

do $$ begin if not exists (select 1 from pg_constraint where conname = 'invoices_amount_nonneg_chk' and conrelid = 'public.invoices'::regclass) then
  alter table public.invoices add constraint invoices_amount_nonneg_chk check (amount >= 0);
end if; end $$;
do $$ begin if not exists (select 1 from pg_constraint where conname = 'invoices_currency_chk' and conrelid = 'public.invoices'::regclass) then
  alter table public.invoices add constraint invoices_currency_chk check (currency ~ '^[A-Z]{3}$');
end if; end $$;
do $$ begin if not exists (select 1 from pg_constraint where conname = 'invoices_due_chk' and conrelid = 'public.invoices'::regclass) then
  alter table public.invoices add constraint invoices_due_chk check (due_at is null or due_at >= issued_at);
end if; end $$;
do $$ begin if not exists (select 1 from pg_constraint where conname = 'invoices_notes_len_chk' and conrelid = 'public.invoices'::regclass) then
  alter table public.invoices add constraint invoices_notes_len_chk check (char_length(notes) <= 2000);
end if; end $$;
do $$ begin if not exists (select 1 from pg_constraint where conname = 'invoices_client_name_len_chk' and conrelid = 'public.invoices'::regclass) then
  alter table public.invoices add constraint invoices_client_name_len_chk check (char_length(client_name) <= 200);
end if; end $$;

create index if not exists idx_invoices_workspace_issued on public.invoices (workspace_id, issued_at desc, created_at desc);

alter table public.invoice_items add column if not exists position integer not null default 0;
alter table public.invoice_items alter column quantity type numeric(12, 3);
alter table public.invoice_items alter column unit_price type numeric(12, 2);
do $$ begin if not exists (select 1 from pg_constraint where conname = 'invoice_items_description_chk' and conrelid = 'public.invoice_items'::regclass) then
  alter table public.invoice_items add constraint invoice_items_description_chk
  check (char_length(btrim(description)) between 1 and 200);
end if; end $$;
do $$ begin if not exists (select 1 from pg_constraint where conname = 'invoice_items_quantity_chk' and conrelid = 'public.invoice_items'::regclass) then
  alter table public.invoice_items add constraint invoice_items_quantity_chk check (quantity > 0);
end if; end $$;
do $$ begin if not exists (select 1 from pg_constraint where conname = 'invoice_items_unit_price_chk' and conrelid = 'public.invoice_items'::regclass) then
  alter table public.invoice_items add constraint invoice_items_unit_price_chk check (unit_price >= 0);
end if; end $$;

alter table public.payments alter column amount type numeric(12, 2);
alter table public.payments add column if not exists voided_at timestamptz;
alter table public.payments add column if not exists created_by uuid references public.profiles(id) on delete set null;
do $$ begin if not exists (select 1 from pg_constraint where conname = 'payments_amount_pos_chk' and conrelid = 'public.payments'::regclass) then
  alter table public.payments add constraint payments_amount_pos_chk check (amount > 0);
end if; end $$;
create index if not exists idx_payments_invoice_active on public.payments (invoice_id) where voided_at is null;

do $$
begin
  if not exists (select 1 from public.payments where invoice_id is null) then
    alter table public.payments alter column invoice_id set not null;
  else
    raise warning 'payments.invoice_id left nullable: orphan payment rows exist';
  end if;
end
$$;

-- 2. Numbering --------------------------------------------------------------------------------------------
create table if not exists public.invoice_counters (
  workspace_id uuid not null references public.workspaces(id) on delete cascade,
  year integer not null,
  last_value integer not null default 0 check (last_value >= 0),
  primary key (workspace_id, year)
);
alter table public.invoice_counters enable row level security;
revoke all on public.invoice_counters from anon, authenticated;
grant all on public.invoice_counters to service_role;

create or replace function public.next_invoice_number(p_workspace_id uuid)
returns text
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_tz text;
  v_year integer;
  v_n integer;
  v_number text;
begin
  if not public.has_workspace_permission(p_workspace_id, 'finance.edit') then
    raise exception 'forbidden' using errcode = '42501';
  end if;
  select w.timezone into v_tz from public.workspaces w where w.id = p_workspace_id;
  if v_tz is null then
    raise exception 'not_found' using errcode = 'P0002';
  end if;
  v_year := extract(year from (now() at time zone v_tz))::integer;

  loop
    -- Atomic: the ON CONFLICT path row-locks the counter, so concurrent callers queue and each gets a new value.
    insert into public.invoice_counters as c (workspace_id, year, last_value)
    values (p_workspace_id, v_year, 1)
    on conflict (workspace_id, year) do update set last_value = c.last_value + 1
    returning c.last_value into v_n;

    v_number := 'INV-' || v_year::text || '-' || case when v_n < 10000 then lpad(v_n::text, 4, '0') else v_n::text end;
    -- A hand-made / imported number that already exists is skipped, never reused.
    exit when not exists (select 1 from public.invoices i where i.workspace_id = p_workspace_id and i.number = v_number);
  end loop;
  return v_number;
end;
$$;

-- 3. Privacy helper (two axes; finance.view / finance.edit are added by the policies) --------------------
create or replace function public.can_access_invoice_row(
  p_workspace_id uuid, p_visibility public.invoice_visibility, p_bucket_id uuid
)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select public.is_workspace_member(p_workspace_id)
     and (
       case when exists (
              select 1 from public.financial_buckets b
              where b.id = p_bucket_id and b.workspace_id = p_workspace_id and b.kind = 'private')
         then public.has_workspace_permission(p_workspace_id, 'financial_bucket.private.view')
         else public.has_workspace_permission(p_workspace_id, 'financial_bucket.main.view')
       end)
     and (
       p_visibility = 'normal'
       or (p_visibility in ('private', 'custom') and public.has_workspace_permission(p_workspace_id, 'private_records.view'))
       or (p_visibility = 'owner_only' and public.has_workspace_permission(p_workspace_id, 'owner_records.view'))
     );
$$;

-- Read-time status: overdue is derived, never stored (see header).
create or replace function public.invoice_effective_status(p_status public.invoice_status, p_due_at date, p_today date)
returns public.invoice_status
language sql
immutable
set search_path = ''
as $$
  select case
    when p_status in ('sent', 'partially_paid') and p_due_at is not null and p_due_at < p_today
      then 'overdue'::public.invoice_status
    else p_status
  end;
$$;

-- 4. Integrity triggers -----------------------------------------------------------------------------------
-- Same-workspace guard for client / appointment / bucket (0011 pattern; separate function, 0011 untouched).
create or replace function public.guard_invoice_references()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if new.client_id is not null and not exists (
       select 1 from public.clients c where c.id = new.client_id and c.workspace_id = new.workspace_id) then
    raise exception 'cross_workspace_reference' using errcode = '23514';
  end if;
  if new.appointment_id is not null and not exists (
       select 1 from public.appointments a where a.id = new.appointment_id and a.workspace_id = new.workspace_id) then
    raise exception 'cross_workspace_reference' using errcode = '23514';
  end if;
  if new.financial_bucket_id is not null and not exists (
       select 1 from public.financial_buckets b where b.id = new.financial_bucket_id and b.workspace_id = new.workspace_id) then
    raise exception 'cross_workspace_reference' using errcode = '23514';
  end if;
  return new;
end;
$$;

-- Totals helper used by the guards (definer: sees every row of the invoice).
create or replace function public.invoice_total_and_paid(p_invoice_id uuid, out total_amount numeric, out paid_amount numeric)
language sql
stable
security definer
set search_path = ''
as $$
  select
    coalesce((select sum(round(i.quantity * i.unit_price, 2)) from public.invoice_items i where i.invoice_id = p_invoice_id), 0),
    coalesce((select sum(p.amount) from public.payments p where p.invoice_id = p_invoice_id and p.voided_at is null), 0);
$$;

create or replace function public.guard_invoice_write()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_total numeric;
  v_paid numeric;
begin
  new.updated_at := now();

  if tg_op = 'INSERT' then
    -- Items fill the amount afterwards; a new invoice is draft or sent, never born paid.
    new.amount := 0;
    if new.status not in ('draft', 'sent') then
      raise exception 'invalid_status' using errcode = '23514';
    end if;
    return new;
  end if;

  -- UPDATE
  if new.workspace_id is distinct from old.workspace_id or new.number is distinct from old.number then
    raise exception 'invoice_identity_immutable' using errcode = '23514';
  end if;
  -- A cancelled invoice is final. (Relation columns added by other migrations, e.g. job_id set null by an
  -- ON DELETE SET NULL, are deliberately not part of this lock.)
  if old.status = 'void' and (
       (new.status, new.client_id, new.client_name, new.appointment_id, new.financial_bucket_id, new.visibility,
        new.currency, new.issued_at, new.due_at, new.notes)
       is distinct from
       (old.status, old.client_id, old.client_name, old.appointment_id, old.financial_bucket_id, old.visibility,
        old.currency, old.issued_at, old.due_at, old.notes)) then
    raise exception 'invoice_cancelled' using errcode = '23514';
  end if;

  select t.total_amount, t.paid_amount into v_total, v_paid from public.invoice_total_and_paid(old.id) t;
  new.amount := v_total; -- derived: a direct write of amount is overwritten

  if new.status = 'draft' and old.status <> 'draft' then
    raise exception 'invoice_already_issued' using errcode = '23514';
  end if;
  if new.status = 'paid' and not (v_paid > 0 and v_paid >= v_total) then
    raise exception 'status_payment_mismatch' using errcode = '23514';
  end if;
  if new.status = 'partially_paid' and not (v_paid > 0 and v_paid < v_total) then
    raise exception 'status_payment_mismatch' using errcode = '23514';
  end if;
  if new.status in ('draft', 'sent', 'overdue') and v_paid > 0 then
    raise exception 'status_payment_mismatch' using errcode = '23514';
  end if;
  if new.status = 'void' and v_paid > 0 then
    raise exception 'invoice_has_payments' using errcode = '23514';
  end if;
  return new;
end;
$$;

-- Recomputes amount + status of one invoice from its items and payments.
create or replace function public.recompute_invoice(p_invoice_id uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v public.invoices%rowtype;
  v_total numeric;
  v_paid numeric;
  v_status public.invoice_status;
begin
  select * into v from public.invoices where id = p_invoice_id for update;
  if not found or v.status = 'void' then
    return; -- parent gone (workspace cascade) or final
  end if;
  select t.total_amount, t.paid_amount into v_total, v_paid from public.invoice_total_and_paid(v.id) t;
  if v_paid > v_total then
    raise exception 'amount_below_paid' using errcode = '23514';
  end if;
  v_status := case
    when v_paid > 0 and v_paid >= v_total then 'paid'::public.invoice_status
    when v_paid > 0 then 'partially_paid'::public.invoice_status
    when v.status in ('paid', 'partially_paid') then 'sent'::public.invoice_status
    else v.status
  end;
  if v_total is distinct from v.amount or v_status is distinct from v.status then
    update public.invoices set amount = v_total, status = v_status where id = v.id;
  end if;
end;
$$;

create or replace function public.guard_invoice_item_write()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_status public.invoice_status;
  v_id uuid;
begin
  v_id := case when tg_op = 'DELETE' then old.invoice_id else new.invoice_id end;
  select i.status into v_status from public.invoices i where i.id = v_id for update;
  if v_status is null then
    if tg_op = 'DELETE' then return old; end if; -- parent already gone (workspace cascade)
    raise exception 'not_found' using errcode = 'P0002';
  end if;
  if tg_op = 'UPDATE' and new.invoice_id is distinct from old.invoice_id then
    raise exception 'invoice_item_identity_immutable' using errcode = '23514';
  end if;
  if v_status in ('paid', 'void') then
    raise exception 'invoice_locked' using errcode = '23514';
  end if;
  return case when tg_op = 'DELETE' then old else new end;
end;
$$;

create or replace function public.after_invoice_item_change()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  perform public.recompute_invoice(case when tg_op = 'DELETE' then old.invoice_id else new.invoice_id end);
  return null;
end;
$$;

create or replace function public.guard_payment_write()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v public.invoices%rowtype;
  v_total numeric;
  v_paid numeric;
begin
  if tg_op = 'INSERT' then
    select * into v from public.invoices where id = new.invoice_id for update; -- serialises concurrent payments
    if not found then
      raise exception 'not_found' using errcode = 'P0002';
    end if;
    if new.workspace_id is distinct from v.workspace_id then
      raise exception 'cross_workspace_reference' using errcode = '23514';
    end if;
    if v.status = 'void' then
      raise exception 'invoice_cancelled' using errcode = '23514';
    end if;
    if new.voided_at is not null then
      raise exception 'payment_invalid' using errcode = '23514';
    end if;
    select t.total_amount, t.paid_amount into v_total, v_paid from public.invoice_total_and_paid(v.id) t;
    if v_paid + new.amount > v_total then
      raise exception 'overpayment' using errcode = '23514';
    end if;
    new.currency := v.currency;
    new.created_by := (select auth.uid());
    return new;
  end if;

  -- UPDATE: a payment is immutable except for being voided (once).
  if (new.id, new.workspace_id, new.invoice_id, new.amount, new.currency, new.method, new.paid_at, new.created_at, new.created_by)
       is distinct from
     (old.id, old.workspace_id, old.invoice_id, old.amount, old.currency, old.method, old.paid_at, old.created_at, old.created_by)
     or (old.voided_at is not null and new.voided_at is distinct from old.voided_at) then
    raise exception 'payment_immutable' using errcode = '23514';
  end if;
  return new;
end;
$$;

create or replace function public.after_payment_change()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  perform public.recompute_invoice(new.invoice_id);
  return null;
end;
$$;

create or replace function public.guard_invoice_restrict_delete()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if not exists (select 1 from public.workspaces w where w.id = old.workspace_id) then
    return old; -- the whole workspace is being deleted
  end if;
  raise exception 'restrict_delete: % rows are history; cancel the invoice / void the payment instead', tg_table_name
    using errcode = '23503';
end;
$$;

drop trigger if exists invoices_guard_refs on public.invoices;
create trigger invoices_guard_refs
  before insert or update on public.invoices
  for each row execute function public.guard_invoice_references();
drop trigger if exists invoices_guard_write on public.invoices;
create trigger invoices_guard_write
  before insert or update on public.invoices
  for each row execute function public.guard_invoice_write();
drop trigger if exists invoices_restrict_delete on public.invoices;
create trigger invoices_restrict_delete
  before delete on public.invoices
  for each row execute function public.guard_invoice_restrict_delete();

drop trigger if exists invoice_items_guard on public.invoice_items;
create trigger invoice_items_guard
  before insert or update or delete on public.invoice_items
  for each row execute function public.guard_invoice_item_write();
drop trigger if exists invoice_items_after on public.invoice_items;
create trigger invoice_items_after
  after insert or update or delete on public.invoice_items
  for each row execute function public.after_invoice_item_change();

drop trigger if exists payments_guard on public.payments;
create trigger payments_guard
  before insert or update on public.payments
  for each row execute function public.guard_payment_write();
drop trigger if exists payments_after on public.payments;
create trigger payments_after
  after insert or update on public.payments
  for each row execute function public.after_payment_change();
drop trigger if exists payments_restrict_delete on public.payments;
create trigger payments_restrict_delete
  before delete on public.payments
  for each row execute function public.guard_invoice_restrict_delete();

-- 5. RLS (split per command) -------------------------------------------------------------------------------
alter table public.invoices enable row level security;
alter table public.invoice_items enable row level security;
alter table public.payments enable row level security;

drop policy if exists invoices_select on public.invoices;
create policy invoices_select on public.invoices
  for select to authenticated
  using (public.has_workspace_permission(workspace_id, 'finance.view')
         and public.can_access_invoice_row(workspace_id, visibility, financial_bucket_id));
drop policy if exists invoices_insert on public.invoices;
create policy invoices_insert on public.invoices
  for insert to authenticated
  with check (public.has_workspace_permission(workspace_id, 'finance.edit')
              and public.can_access_invoice_row(workspace_id, visibility, financial_bucket_id));
drop policy if exists invoices_update on public.invoices;
create policy invoices_update on public.invoices
  for update to authenticated
  using (public.has_workspace_permission(workspace_id, 'finance.edit')
         and public.can_access_invoice_row(workspace_id, visibility, financial_bucket_id))
  with check (public.has_workspace_permission(workspace_id, 'finance.edit')
              and public.can_access_invoice_row(workspace_id, visibility, financial_bucket_id));
-- no delete policy: invoices are never deleted

drop policy if exists invoice_items_select on public.invoice_items;
create policy invoice_items_select on public.invoice_items
  for select to authenticated
  using (exists (select 1 from public.invoices i
                 where i.id = invoice_items.invoice_id
                   and public.has_workspace_permission(i.workspace_id, 'finance.view')
                   and public.can_access_invoice_row(i.workspace_id, i.visibility, i.financial_bucket_id)));
drop policy if exists invoice_items_insert on public.invoice_items;
create policy invoice_items_insert on public.invoice_items
  for insert to authenticated
  with check (exists (select 1 from public.invoices i
                      where i.id = invoice_items.invoice_id
                        and public.has_workspace_permission(i.workspace_id, 'finance.edit')
                        and public.can_access_invoice_row(i.workspace_id, i.visibility, i.financial_bucket_id)));
drop policy if exists invoice_items_update on public.invoice_items;
create policy invoice_items_update on public.invoice_items
  for update to authenticated
  using (exists (select 1 from public.invoices i
                 where i.id = invoice_items.invoice_id
                   and public.has_workspace_permission(i.workspace_id, 'finance.edit')
                   and public.can_access_invoice_row(i.workspace_id, i.visibility, i.financial_bucket_id)))
  with check (exists (select 1 from public.invoices i
                      where i.id = invoice_items.invoice_id
                        and public.has_workspace_permission(i.workspace_id, 'finance.edit')
                        and public.can_access_invoice_row(i.workspace_id, i.visibility, i.financial_bucket_id)));
drop policy if exists invoice_items_delete on public.invoice_items;
create policy invoice_items_delete on public.invoice_items
  for delete to authenticated
  using (exists (select 1 from public.invoices i
                 where i.id = invoice_items.invoice_id
                   and public.has_workspace_permission(i.workspace_id, 'finance.edit')
                   and public.can_access_invoice_row(i.workspace_id, i.visibility, i.financial_bucket_id)));

drop policy if exists payments_select on public.payments;
create policy payments_select on public.payments
  for select to authenticated
  using (exists (select 1 from public.invoices i
                 where i.id = payments.invoice_id
                   and public.has_workspace_permission(i.workspace_id, 'finance.view')
                   and public.can_access_invoice_row(i.workspace_id, i.visibility, i.financial_bucket_id)));
drop policy if exists payments_insert on public.payments;
create policy payments_insert on public.payments
  for insert to authenticated
  with check (exists (select 1 from public.invoices i
                      where i.id = payments.invoice_id
                        and i.workspace_id = payments.workspace_id
                        and public.has_workspace_permission(i.workspace_id, 'finance.edit')
                        and public.can_access_invoice_row(i.workspace_id, i.visibility, i.financial_bucket_id)));
drop policy if exists payments_update on public.payments;
create policy payments_update on public.payments
  for update to authenticated
  using (exists (select 1 from public.invoices i
                 where i.id = payments.invoice_id
                   and public.has_workspace_permission(i.workspace_id, 'finance.edit')
                   and public.can_access_invoice_row(i.workspace_id, i.visibility, i.financial_bucket_id)))
  with check (exists (select 1 from public.invoices i
                      where i.id = payments.invoice_id
                        and i.workspace_id = payments.workspace_id
                        and public.has_workspace_permission(i.workspace_id, 'finance.edit')
                        and public.can_access_invoice_row(i.workspace_id, i.visibility, i.financial_bucket_id)));
-- no delete policy: payments are voided, never deleted

revoke all on public.invoices from anon;
revoke all on public.invoice_items from anon;
revoke all on public.payments from anon;
revoke delete on public.invoices from authenticated;
revoke delete on public.payments from authenticated;

-- 6. Write API (SECURITY INVOKER: RLS applies) ---------------------------------------------------------------
create or replace function public.create_invoice(
  p_workspace_id uuid,
  p_client_id uuid default null,
  p_client_name text default '',
  p_appointment_id uuid default null,
  p_bucket_kind text default 'main',
  p_bucket_id uuid default null,
  p_visibility text default 'normal',
  p_status text default 'sent',
  p_currency text default null,
  p_issued_at date default null,
  p_due_at date default null,
  p_notes text default '',
  p_items jsonb default '[]'::jsonb
)
returns uuid
language plpgsql
security invoker
set search_path = ''
as $$
declare
  v_tz text;
  v_default_currency text;
  v_client_name text := btrim(coalesce(p_client_name, ''));
  v_bucket uuid;
  v_id uuid;
  v_number text;
begin
  if p_status not in ('draft', 'sent') then
    raise exception 'invalid_input' using errcode = '22023';
  end if;
  if p_items is null or jsonb_typeof(p_items) <> 'array' or jsonb_array_length(p_items) > 100 then
    raise exception 'invalid_input' using errcode = '22023';
  end if;

  select w.timezone, w.default_currency into v_tz, v_default_currency
  from public.workspaces w where w.id = p_workspace_id;
  if v_tz is null then
    raise exception 'not_found' using errcode = 'P0002';
  end if;

  if p_client_id is not null then
    select c.name into v_client_name from public.clients c
    where c.id = p_client_id and c.workspace_id = p_workspace_id;
    if not found then
      raise exception 'client_not_found' using errcode = 'P0002';
    end if;
  end if;
  if p_appointment_id is not null and not exists (
       select 1 from public.appointments a where a.id = p_appointment_id and a.workspace_id = p_workspace_id) then
    raise exception 'appointment_not_found' using errcode = 'P0002';
  end if;

  v_bucket := public.resolve_financial_bucket(p_workspace_id, p_bucket_kind, p_bucket_id);
  v_number := public.next_invoice_number(p_workspace_id);

  insert into public.invoices (
    workspace_id, number, client_id, client_name, appointment_id, financial_bucket_id, visibility, status,
    currency, issued_at, due_at, notes
  ) values (
    p_workspace_id, v_number, p_client_id, left(v_client_name, 200), p_appointment_id, v_bucket,
    p_visibility::public.invoice_visibility, p_status::public.invoice_status,
    coalesce(upper(p_currency), v_default_currency),
    coalesce(p_issued_at, (now() at time zone v_tz)::date), p_due_at, coalesce(p_notes, '')
  ) returning id into v_id;

  insert into public.invoice_items (invoice_id, description, quantity, unit_price, position)
  select v_id, btrim(e.item ->> 'description'), coalesce((e.item ->> 'quantity')::numeric, 1),
         coalesce((e.item ->> 'unit_price')::numeric, 0), (e.ord - 1)::integer
  from jsonb_array_elements(p_items) with ordinality as e(item, ord);

  return v_id;
end;
$$;

create or replace function public.replace_invoice_items(p_invoice_id uuid, p_items jsonb)
returns void
language plpgsql
security invoker
set search_path = ''
as $$
declare
  v_old uuid[];
begin
  if p_items is null or jsonb_typeof(p_items) <> 'array' or jsonb_array_length(p_items) > 100 then
    raise exception 'invalid_input' using errcode = '22023';
  end if;
  perform 1 from public.invoices i where i.id = p_invoice_id;
  if not found then
    raise exception 'not_found' using errcode = 'P0002';
  end if;
  select coalesce(array_agg(it.id), '{}') into v_old from public.invoice_items it where it.invoice_id = p_invoice_id;

  -- New lines first, old lines second: the total never dips below what was already paid mid-way.
  insert into public.invoice_items (invoice_id, description, quantity, unit_price, position)
  select p_invoice_id, btrim(e.item ->> 'description'), coalesce((e.item ->> 'quantity')::numeric, 1),
         coalesce((e.item ->> 'unit_price')::numeric, 0), (e.ord - 1)::integer
  from jsonb_array_elements(p_items) with ordinality as e(item, ord);
  delete from public.invoice_items where id = any (v_old);
end;
$$;

create or replace function public.record_payment(
  p_invoice_id uuid, p_amount numeric, p_method text default 'cash', p_paid_at timestamptz default null
)
returns uuid
language plpgsql
security invoker
set search_path = ''
as $$
declare
  v_ws uuid;
  v_id uuid;
begin
  select i.workspace_id into v_ws from public.invoices i where i.id = p_invoice_id;
  if not found then
    raise exception 'not_found' using errcode = 'P0002';
  end if;
  insert into public.payments (workspace_id, invoice_id, amount, method, paid_at)
  values (v_ws, p_invoice_id, p_amount, p_method::public.payment_method, coalesce(p_paid_at, now()))
  returning id into v_id;
  return v_id;
end;
$$;

-- Marks every active payment of the invoice as voided (the "mark as unpaid" action). History stays.
create or replace function public.void_invoice_payments(p_invoice_id uuid)
returns integer
language plpgsql
security invoker
set search_path = ''
as $$
declare
  v_n integer;
begin
  perform 1 from public.invoices i where i.id = p_invoice_id;
  if not found then
    raise exception 'not_found' using errcode = 'P0002';
  end if;
  update public.payments set voided_at = now() where invoice_id = p_invoice_id and voided_at is null;
  get diagnostics v_n = row_count;
  return v_n;
end;
$$;

create or replace function public.cancel_invoice(p_invoice_id uuid)
returns void
language plpgsql
security invoker
set search_path = ''
as $$
begin
  update public.invoices set status = 'void' where id = p_invoice_id and status <> 'void';
  if not found then
    raise exception 'not_found' using errcode = 'P0002';
  end if;
end;
$$;

-- Items of every invoice the caller may see in one workspace (RLS applies: SECURITY INVOKER). Avoids a
-- huge `in (...)` filter from the app.
create or replace function public.list_invoice_items(p_workspace_id uuid)
returns setof public.invoice_items
language sql
stable
security invoker
set search_path = ''
as $$
  select it.*
  from public.invoice_items it
  join public.invoices i on i.id = it.invoice_id
  where i.workspace_id = p_workspace_id
  order by it.invoice_id, it.position, it.created_at;
$$;

-- 7. Grants -----------------------------------------------------------------------------------------------------
revoke all on function public.guard_invoice_references() from public, anon, authenticated;
revoke all on function public.guard_invoice_write() from public, anon, authenticated;
revoke all on function public.guard_invoice_item_write() from public, anon, authenticated;
revoke all on function public.after_invoice_item_change() from public, anon, authenticated;
revoke all on function public.guard_payment_write() from public, anon, authenticated;
revoke all on function public.after_payment_change() from public, anon, authenticated;
revoke all on function public.guard_invoice_restrict_delete() from public, anon, authenticated;
revoke all on function public.recompute_invoice(uuid) from public, anon, authenticated;
revoke all on function public.invoice_total_and_paid(uuid) from public, anon, authenticated;

revoke all on function public.next_invoice_number(uuid) from public, anon;
revoke all on function public.can_access_invoice_row(uuid, public.invoice_visibility, uuid) from public, anon;
revoke all on function public.invoice_effective_status(public.invoice_status, date, date) from public, anon;
revoke all on function public.create_invoice(uuid, uuid, text, uuid, text, uuid, text, text, text, date, date, text, jsonb) from public, anon;
revoke all on function public.replace_invoice_items(uuid, jsonb) from public, anon;
revoke all on function public.record_payment(uuid, numeric, text, timestamptz) from public, anon;
revoke all on function public.void_invoice_payments(uuid) from public, anon;
revoke all on function public.cancel_invoice(uuid) from public, anon;
grant execute on function public.next_invoice_number(uuid) to authenticated, service_role;
grant execute on function public.can_access_invoice_row(uuid, public.invoice_visibility, uuid) to authenticated, service_role;
grant execute on function public.invoice_effective_status(public.invoice_status, date, date) to authenticated, service_role;
grant execute on function public.create_invoice(uuid, uuid, text, uuid, text, uuid, text, text, text, date, date, text, jsonb) to authenticated, service_role;
grant execute on function public.replace_invoice_items(uuid, jsonb) to authenticated, service_role;
grant execute on function public.record_payment(uuid, numeric, text, timestamptz) to authenticated, service_role;
grant execute on function public.void_invoice_payments(uuid) to authenticated, service_role;
grant execute on function public.cancel_invoice(uuid) to authenticated, service_role;
revoke all on function public.list_invoice_items(uuid) from public, anon;
grant execute on function public.list_invoice_items(uuid) to authenticated, service_role;
