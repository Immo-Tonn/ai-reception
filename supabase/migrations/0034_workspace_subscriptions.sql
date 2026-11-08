-- ServiceOS — 0034: the business's own ServiceOS subscription (Stripe), kept in
-- sync by the Stripe webhook (src/app/api/stripe/webhook). Setup: docs/STRIPE_SETUP_RU.md.
--
--   workspace_subscriptions : at most one per workspace. Stripe ids, plan and
--       status only — no card data, names or e-mail addresses.
--
-- SERVICE ROLE ONLY. RLS is enabled with NO policies and every privilege is
-- revoked from anon / authenticated / PUBLIC. The server reads the row after
-- its own `billing.manage` check (same model as 0025).
--
-- Follows the GDPR chain (0028-0033) in numbering. Depends only on
-- `workspaces`, not on any GDPR migration.
-- Idempotent; no existing table or row is changed.

create table if not exists public.workspace_subscriptions (
  workspace_id uuid primary key references public.workspaces(id) on delete cascade,
  stripe_customer_id text not null check (stripe_customer_id ~ '^cus_[A-Za-z0-9]+$'),
  stripe_subscription_id text not null check (stripe_subscription_id ~ '^sub_[A-Za-z0-9]+$'),
  plan text check (plan is null or plan in ('start', 'business', 'pro')),
  status text not null check (char_length(status) between 1 and 40),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

alter table public.workspace_subscriptions enable row level security;
revoke all on table public.workspace_subscriptions from public, anon, authenticated;
grant select, insert, update, delete on table public.workspace_subscriptions to service_role;

-- Atomic save. Events for the stored subscription always apply. Another
-- subscription (a new purchase after a cancellation) replaces the row only if
-- it is live and the stored one is not: a late event about an old subscription,
-- or a duplicate purchase, can never overwrite the one being paid for.
-- Returns true when the row was written.
create or replace function public.save_workspace_subscription(
  p_workspace_id uuid,
  p_customer_id text,
  p_subscription_id text,
  p_plan text,
  p_status text
)
returns boolean
language plpgsql
security invoker
set search_path = ''
as $$
declare
  v_live constant text[] := array['active', 'trialing', 'past_due', 'unpaid'];
  v_written boolean;
begin
  insert into public.workspace_subscriptions as s
    (workspace_id, stripe_customer_id, stripe_subscription_id, plan, status)
  values (p_workspace_id, p_customer_id, p_subscription_id, p_plan, p_status)
  on conflict (workspace_id) do update
    set stripe_customer_id = excluded.stripe_customer_id,
        stripe_subscription_id = excluded.stripe_subscription_id,
        plan = excluded.plan,
        status = excluded.status,
        updated_at = now()
    where s.stripe_subscription_id = excluded.stripe_subscription_id
       or (excluded.status = any (v_live) and not s.status = any (v_live))
  returning true into v_written;
  return coalesce(v_written, false);
end;
$$;

revoke all on function public.save_workspace_subscription(uuid, text, text, text, text) from public, anon, authenticated;
grant execute on function public.save_workspace_subscription(uuid, text, text, text, text) to service_role;
