-- Job-photos Supabase Storage setup — RUN THIS IN THE SUPABASE SQL EDITOR, NOT via drizzle.
--
-- Why this is not a drizzle migration: `storage.objects` is owned by `supabase_storage_admin`,
-- so `create policy ... on storage.objects` (and creating objects in the `storage` schema) requires
-- privileges the pooled `postgres` migration role used by `db:migrate` does not have. Attempting it
-- inside a migration aborts the whole pending batch. The Supabase SQL editor runs with the necessary
-- role membership, so run this there once (idempotent — safe to re-run).
--
-- This provisions the private `job-photos` bucket and the tenant-isolation policies. The object key
-- layout is <org_id>/<job_id>/<uuid>.<ext>, so the first path segment IS the org id. Browser
-- reads/writes are allowed only when that first segment equals the caller's org, derived from the JWT
-- app_metadata org_id claim the app sets at signup. The service-role client (getSupabaseAdmin) bypasses
-- these policies and is what mints signed upload URLs server-side.

-- storage.objects/buckets are owned by supabase_storage_admin; CREATE POLICY needs the owner
-- role. In the Supabase SQL editor the session runs as `postgres`, which is a MEMBER of
-- supabase_storage_admin, so switch to it for this script, then reset at the end.
set role supabase_storage_admin;

insert into storage.buckets (id, name, public)
values ('job-photos', 'job-photos', false)
on conflict (id) do nothing;

-- Mirrors public.current_org_id() but reads the org from the Storage request's JWT claim
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

drop policy if exists job_photos_read on storage.objects;
create policy job_photos_read on storage.objects
  for select
  to authenticated
  using (
    bucket_id = 'job-photos'
    and (storage.foldername(name))[1] = storage.job_photo_org()::text
  );

drop policy if exists job_photos_insert on storage.objects;
create policy job_photos_insert on storage.objects
  for insert
  to authenticated
  with check (
    bucket_id = 'job-photos'
    and (storage.foldername(name))[1] = storage.job_photo_org()::text
  );

-- ── team-files: staff-chat attachments ────────────────────────────────────────────────────────
-- Same tenant model as job-photos (first path segment IS the org id), with two differences that
-- matter:
--
--   1. This bucket sets file_size_limit and allowed_mime_types. job-photos sets NEITHER, so
--      nothing there stops a 50MB upload except the browser's own downscale — storage is the
--      only layer that can refuse bytes it was never told to accept, so it does here.
--   2. Reads are served by SHORT-LIVED SIGNED URLs minted server-side (see
--      SupabaseChatFileGateway.createViewUrl) after the caller's THREAD membership is checked in
--      the application layer. The select policy below is the tenant floor beneath that, not the
--      privacy boundary: storage RLS can see the org claim in the JWT but knows nothing about
--      which conversations a person belongs to.
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('team-files', 'team-files', false, 10485760, array['image/jpeg', 'image/png', 'image/webp'])
on conflict (id) do update
  set file_size_limit = excluded.file_size_limit,
      allowed_mime_types = excluded.allowed_mime_types;

drop policy if exists team_files_read on storage.objects;
create policy team_files_read on storage.objects
  for select
  to authenticated
  using (
    bucket_id = 'team-files'
    and (storage.foldername(name))[1] = storage.job_photo_org()::text
  );

drop policy if exists team_files_insert on storage.objects;
create policy team_files_insert on storage.objects
  for insert
  to authenticated
  with check (
    bucket_id = 'team-files'
    and (storage.foldername(name))[1] = storage.job_photo_org()::text
  );

reset role;
