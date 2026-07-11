-- Private Supabase Storage bucket for job photos + tenant-isolation policies. The object key
-- layout is <org_id>/<job_id>/<uuid>.<ext>, so the first path segment IS the org id. Reads/writes
-- are allowed only when that first segment equals the caller's org, derived from the JWT app_metadata
-- org_id claim the app sets at signup. The service-role client (getSupabaseAdmin) bypasses these
-- policies and is what mints signed upload URLs server-side; end-user browser reads go through
-- these policies. Idempotent: safe to re-run.

insert into storage.buckets (id, name, public)
values ('job-photos', 'job-photos', false)
on conflict (id) do nothing;
--> statement-breakpoint

-- Helper mirrors public.current_org_id() but reads the org from the Storage request's JWT claim
-- (storage runs as the authenticated user, not inside a withTenant tx). Falls back to NULL (deny).
create or replace function storage.job_photo_org()
returns uuid
language sql
stable
as $$
  select nullif(
    coalesce(
      current_setting('request.jwt.claims', true)::jsonb -> 'app_metadata' ->> 'org_id',
      ''
    ),
    ''
  )::uuid
$$;
--> statement-breakpoint

drop policy if exists job_photos_read ON storage.objects;
--> statement-breakpoint
create policy job_photos_read on storage.objects
  for select
  to authenticated
  using (
    bucket_id = 'job-photos'
    and (storage.foldername(name))[1] = storage.job_photo_org()::text
  );
--> statement-breakpoint

drop policy if exists job_photos_insert ON storage.objects;
--> statement-breakpoint
create policy job_photos_insert on storage.objects
  for insert
  to authenticated
  with check (
    bucket_id = 'job-photos'
    and (storage.foldername(name))[1] = storage.job_photo_org()::text
  );
