# Proposed migration: business logo storage (NOT applied, NOT in supabase/migrations)

`workspaces.logo_path` (0017) is only a reference `'<workspace_id>/<file>'`. Real upload needs a
Storage bucket + policies, plus a server action. Until then the UI shows the business initial and
says upload is not available yet.

## Bucket and policies (sketch, to be reviewed before it becomes migration 0018)

```sql
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('business-logos', 'business-logos', false, 1048576, array['image/png','image/jpeg','image/webp'])
on conflict (id) do nothing;

-- Members with settings.manage of THAT workspace may write/replace/remove objects under '<workspace_id>/'.
create policy business_logos_write on storage.objects for all to authenticated
  using (bucket_id = 'business-logos'
         and public.has_workspace_permission(((storage.foldername(name))[1])::uuid, 'settings.manage'))
  with check (bucket_id = 'business-logos'
         and public.has_workspace_permission(((storage.foldername(name))[1])::uuid, 'settings.manage'));
```

## Reading
Private bucket; the server issues short-lived signed URLs only for workspaces with
`public_booking_enabled` (booking page, directory). No public bucket, no URLs stored in the DB.

## App work after applying
Server action: validate type and size, upload under `<workspace_id>/<random>.<ext>`, then set
`workspaces.logo_path` (`updateBusinessProfile`), delete the previous object; show the image via
signed URL on settings, booking page and directory cards; keep the initial as fallback.
