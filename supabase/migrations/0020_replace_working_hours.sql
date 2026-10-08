-- ServiceOS — 0020: atomic "replace all working hours of one owner"
--
-- The schedule editor saves a whole week at once. PostgREST has no transaction, so doing
-- delete-then-insert from the app could leave an owner without hours if the second step failed.
-- This function does both inside ONE statement-level transaction: either the new week is stored
-- or the old week stays untouched.
--
-- SECURITY INVOKER on purpose: it runs with the CALLER's rights, so Row Level Security
-- (settings.manage, 0009/0016), the same-workspace guard (0011) and the integrity trigger (0019:
-- no overlaps, no day-off mixed with intervals) all still apply. It grants nothing new.
-- p_staff_id NULL = the business opening hours. Additive and replay-safe.

create or replace function public.replace_working_hours(p_workspace_id uuid, p_staff_id uuid, p_rows jsonb)
returns void
language plpgsql
security invoker
set search_path = ''
as $$
begin
  if jsonb_typeof(p_rows) is distinct from 'array' then
    raise exception 'invalid_input' using errcode = '22023';
  end if;

  delete from public.working_hours
   where workspace_id = p_workspace_id and staff_id is not distinct from p_staff_id;

  insert into public.working_hours (workspace_id, staff_id, weekday, start_time, end_time, is_day_off)
  select p_workspace_id, p_staff_id,
         (r ->> 'weekday')::smallint,
         nullif(r ->> 'start_time', '')::time,
         nullif(r ->> 'end_time', '')::time,
         coalesce((r ->> 'is_day_off')::boolean, false)
  from jsonb_array_elements(p_rows) as r;
end;
$$;

revoke all on function public.replace_working_hours(uuid, uuid, jsonb) from public, anon;
grant execute on function public.replace_working_hours(uuid, uuid, jsonb) to authenticated, service_role;
