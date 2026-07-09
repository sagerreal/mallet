// READ-ONLY verification of the tasks migration (table + RLS + grant). No writes.
//   node --env-file=.env.local scripts/verify-tasks.mjs
import postgres from "postgres";

const url = process.env.DATABASE_URL;
if (!url) { console.error("DATABASE_URL missing"); process.exit(1); }
const sql = postgres(url, { max: 1, ssl: "require", connect_timeout: 10, prepare: false });

try {
  const [tbl] = await sql`select to_regclass('public.tasks') is not null as exists`;
  const [rls] = await sql`
    select relrowsecurity as enabled, relforcerowsecurity as forced
    from pg_class where oid = 'public.tasks'::regclass`;
  const pol = await sql`select polname from pg_policy where polrelid = 'public.tasks'::regclass`;
  const [g] = await sql`
    select
      has_table_privilege('mallet_app','public.tasks','SELECT') as sel,
      has_table_privilege('mallet_app','public.tasks','INSERT') as ins,
      has_table_privilege('mallet_app','public.tasks','UPDATE') as upd,
      has_table_privilege('mallet_app','public.tasks','DELETE') as del`;
  console.log("tasks exists     :", tbl.exists);
  console.log("RLS enabled/force:", rls?.enabled, "/", rls?.forced);
  console.log("policies         :", pol.map((p) => p.polname).join(", ") || "(none)");
  console.log("mallet_app grant :", g);
} finally {
  await sql.end();
}
