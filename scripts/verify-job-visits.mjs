// READ-ONLY verification of the job_visits migration. No writes, no grants.
//   node --env-file=.env.local scripts/verify-job-visits.mjs
import postgres from "postgres";

const url = process.env.DATABASE_URL;
if (!url) { console.error("DATABASE_URL missing"); process.exit(1); }
const sql = postgres(url, { max: 1, ssl: "require", connect_timeout: 10, prepare: false });

try {
  const [tbl] = await sql`select to_regclass('public.job_visits') is not null as exists`;
  const [rls] = await sql`
    select relrowsecurity as enabled, relforcerowsecurity as forced
    from pg_class where oid = 'public.job_visits'::regclass`;
  const policies = await sql`
    select polname from pg_policy where polrelid = 'public.job_visits'::regclass`;
  const [grant] = await sql`
    select
      has_table_privilege('mallet_app','public.job_visits','SELECT') as sel,
      has_table_privilege('mallet_app','public.job_visits','INSERT') as ins,
      has_table_privilege('mallet_app','public.job_visits','UPDATE') as upd,
      has_table_privilege('mallet_app','public.job_visits','DELETE') as del`;
  const crew = await sql`
    select role, count(*) filter (where is_field_crew) as field_crew, count(*) as total
    from users group by role order by role`;
  const cols = await sql`
    select column_name from information_schema.columns
    where table_name = 'users' and column_name in ('name','is_field_crew') order by column_name`;

  console.log("job_visits exists     :", tbl.exists);
  console.log("RLS enabled / forced  :", rls?.enabled, "/", rls?.forced);
  console.log("policies              :", policies.map((p) => p.polname).join(", ") || "(none)");
  console.log("mallet_app grants     :", grant);
  console.log("users new columns     :", cols.map((c) => c.column_name).join(", "));
  console.log("is_field_crew backfill:", crew);
} finally {
  await sql.end();
}
