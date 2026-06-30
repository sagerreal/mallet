// Quick connectivity check: node --env-file=.env.local scripts/dbcheck.mjs
import postgres from "postgres";

const url = process.env.DATABASE_URL;
if (!url) {
  console.error("DATABASE_URL is not set");
  process.exit(1);
}

const sql = postgres(url, { max: 1, idle_timeout: 5, connect_timeout: 10, ssl: "require" });
try {
  const rows = await sql`select now() as now, current_user as user, version() as version`;
  console.log("CONNECTED ✓");
  console.log(rows[0]);
} catch (e) {
  console.error("CONNECT FAILED:", e.message);
  process.exitCode = 1;
} finally {
  await sql.end({ timeout: 5 });
}
