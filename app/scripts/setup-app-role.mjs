// Creates / updates the least-privilege runtime role `mallet_app` (LOGIN, NOBYPASSRLS)
// and grants it DML on tenant tables. The app connects as this role so RLS is always
// enforced — unlike `postgres`, which has BYPASSRLS and is reserved for migrations.
//
// Idempotent. Run AFTER `pnpm db:migrate`:
//   node --env-file=.env.local scripts/setup-app-role.mjs
import postgres from "postgres";

const adminUrl = process.env.DATABASE_URL;
const appPw = process.env.APP_DB_PASSWORD;
if (!adminUrl || !appPw) {
  console.error("DATABASE_URL and APP_DB_PASSWORD must be set (see .env.local)");
  process.exit(1);
}
// Role passwords can't be parameterized (utility statement). Our generated password is
// hex, but escape single quotes defensively before inlining.
const pwLiteral = `'${appPw.replace(/'/g, "''")}'`;

const sql = postgres(adminUrl, { max: 1, ssl: "require", connect_timeout: 10, prepare: false });
try {
  await sql.unsafe(`
    do $$ begin
      if not exists (select 1 from pg_roles where rolname = 'mallet_app') then
        create role mallet_app login noinherit nobypassrls password ${pwLiteral};
      else
        alter role mallet_app with login noinherit nobypassrls password ${pwLiteral};
      end if;
    end $$;
  `);

  await sql.unsafe(`
    grant usage on schema public to mallet_app;
    grant select, insert, update, delete on all tables in schema public to mallet_app;
    grant usage, select on all sequences in schema public to mallet_app;
    alter default privileges in schema public
      grant select, insert, update, delete on tables to mallet_app;
    alter default privileges in schema public
      grant usage, select on sequences to mallet_app;
  `);

  // The principal resolver is SECURITY DEFINER with its PUBLIC grant revoked — the app role
  // must be explicitly allowed to call it. Idempotent; only run if the function exists yet.
  await sql.unsafe(`
    do $$ begin
      if exists (
        select 1 from pg_proc p join pg_namespace n on n.oid = p.pronamespace
        where n.nspname = 'public' and p.proname = 'app_resolve_principal'
      ) then
        grant execute on function public.app_resolve_principal(uuid) to mallet_app;
      end if;
    end $$;
  `);

  const [r] = await sql`
    select rolcanlogin, rolbypassrls from pg_roles where rolname = 'mallet_app'
  `;
  console.log("mallet_app ready ✓", r);
  if (r.rolbypassrls !== false) {
    console.error("REFUSING: mallet_app must NOT have BYPASSRLS");
    process.exitCode = 1;
  }
} catch (e) {
  console.error("setup-app-role FAILED:", e.message);
  process.exitCode = 1;
} finally {
  await sql.end({ timeout: 5 });
}
