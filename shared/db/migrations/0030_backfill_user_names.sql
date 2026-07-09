-- Backfill public.users.name for existing rows that predate name capture.
-- Reads full_name (Google OAuth) or name from auth.users.raw_user_meta_data and writes it to
-- public.users.name where the column is currently NULL. Rows that already have a name (manually
-- set or previously backfilled) are intentionally left untouched.
-- The join column is auth_user_id (users_auth_user_uidx unique index in 0002_users migration).
UPDATE public.users u
SET name = COALESCE(
  a.raw_user_meta_data ->> 'full_name',
  a.raw_user_meta_data ->> 'name'
)
FROM auth.users a
WHERE a.id = u.auth_user_id
  AND u.name IS NULL
  AND COALESCE(
    a.raw_user_meta_data ->> 'full_name',
    a.raw_user_meta_data ->> 'name'
  ) IS NOT NULL;