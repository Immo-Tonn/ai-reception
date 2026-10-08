-- ServiceOS — 0014: rate limiting storage (provider-independent app boundary,
-- PostgreSQL implementation)
--
-- Used for critical PUBLIC operations (guest booking). It is shared across
-- all server instances — an in-memory limiter on a serverless host would give
-- every lambda its own counter and protect nothing.
--
-- No PII: the application stores only a keyed hash (HMAC) of the subject
-- (IP address, e-mail), never the value itself. Fixed time windows; rows older
-- than two days are pruned opportunistically.
-- Service-role only: RLS on, no policies, EXECUTE revoked from everyone else.

create table if not exists public.rate_limits (
  scope text not null,
  key_hash text not null,
  window_start timestamptz not null,
  hits integer not null default 0,
  primary key (scope, key_hash, window_start)
);

create index if not exists idx_rate_limits_window on public.rate_limits (window_start);

alter table public.rate_limits enable row level security;

create or replace function public.rate_limit_hit(
  p_scope text,
  p_key_hash text,
  p_limit integer,
  p_window_seconds integer
)
returns table (allowed boolean, remaining integer, retry_after_seconds integer)
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_window timestamptz;
  v_hits integer;
begin
  if p_limit < 1 or p_window_seconds < 1 or p_window_seconds > 86400
     or p_scope is null or char_length(p_scope) > 64
     or p_key_hash is null or char_length(p_key_hash) > 128 then
    raise exception 'invalid_input' using errcode = '22023';
  end if;

  v_window := to_timestamp(floor(extract(epoch from now()) / p_window_seconds) * p_window_seconds);

  insert into public.rate_limits as r (scope, key_hash, window_start, hits)
  values (p_scope, p_key_hash, v_window, 1)
  on conflict (scope, key_hash, window_start) do update set hits = r.hits + 1
  returning r.hits into v_hits;

  if random() < 0.02 then
    delete from public.rate_limits where window_start < now() - interval '2 days';
  end if;

  return query select
    v_hits <= p_limit,
    greatest(p_limit - v_hits, 0),
    case when v_hits <= p_limit then 0
         else ceil(extract(epoch from (v_window + make_interval(secs => p_window_seconds) - now())))::integer end;
end;
$$;

revoke all on function public.rate_limit_hit(text, text, integer, integer) from public, anon, authenticated;
grant execute on function public.rate_limit_hit(text, text, integer, integer) to service_role;
