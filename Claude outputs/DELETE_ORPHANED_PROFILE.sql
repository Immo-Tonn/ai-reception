-- ============================================================================
-- Cleanup: remove the one specific orphaned profile row and everything it
-- created, before the auth.users row it belonged to was replaced.
--   profiles.id    = fffacfa5-161f-4f9b-9e5a-86f6e8912b62
--   profiles.email = service-auto@gmx.net
-- ============================================================================

-- 1) Run this first to double-check what's actually attached to this id
--    before deleting anything. Expect: 1 profiles row, and (from the earlier
--    fully-successful test) 1 workspace it created + 1 workspace_members row.
select 'profiles' as table_name, id::text, email, full_name, created_at
from public.profiles
where id = 'fffacfa5-161f-4f9b-9e5a-86f6e8912b62'
union all
select 'workspace_members', profile_id::text, role::text, null, created_at
from public.workspace_members
where profile_id = 'fffacfa5-161f-4f9b-9e5a-86f6e8912b62'
union all
select 'workspaces', id::text, slug, name, created_at
from public.workspaces
where created_by = 'fffacfa5-161f-4f9b-9e5a-86f6e8912b62';

-- 2) If the results above look right (just this one test workspace/profile,
--    nothing you actually care about), run the deletes below, in this order,
--    inside one transaction so it's all-or-nothing:

begin;

delete from public.workspace_members
where profile_id = 'fffacfa5-161f-4f9b-9e5a-86f6e8912b62';

delete from public.workspaces
where created_by = 'fffacfa5-161f-4f9b-9e5a-86f6e8912b62';

delete from public.profiles
where id = 'fffacfa5-161f-4f9b-9e5a-86f6e8912b62';

commit;

-- 3) Verify it's gone:
select * from public.profiles where id = 'fffacfa5-161f-4f9b-9e5a-86f6e8912b62';
-- should return 0 rows
