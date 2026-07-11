-- Intentionally a no-op. The job-photos Supabase Storage bucket + tenant-isolation policies were
-- moved OUT of the drizzle migration chain to `shared/db/storage-setup.sql`, because they touch the
-- `storage` schema (owned by `supabase_storage_admin`) and require privileges the pooled `postgres`
-- role used by `db:migrate` lacks — attempting them here aborts the whole pending migration batch.
-- Run `shared/db/storage-setup.sql` once in the Supabase SQL editor to provision the bucket/policies.
-- This file stays in the chain (journal idx 50) so migration numbering is unbroken.
select 1;
