// Proves multi-tenant isolation against the LIVE database, exercising the exact mechanism
// withTenant() uses: connect as the NOBYPASSRLS `mallet_app` role, set the transaction-local
// GUC app.current_org_id, and let the RLS policies do the scoping.
//
//   node --env-file=.env.local scripts/rls-proof.mjs
//
// Seeds two orgs (as the owner) with one lead each, then queries as the app role and asserts
// each tenant sees only its own data, unscoped queries fail closed, and cross-tenant writes
// are rejected. Cleans up its fixtures regardless of outcome.
import postgres from "postgres";

const adminUrl = process.env.DATABASE_URL;
const appUrl = process.env.APP_DATABASE_URL;
if (!adminUrl || !appUrl) {
  console.error("DATABASE_URL and APP_DATABASE_URL must be set (see .env.local)");
  process.exit(1);
}

const admin = postgres(adminUrl, { max: 1, ssl: "require", prepare: false, connect_timeout: 10 });
const app = postgres(appUrl, { max: 2, ssl: "require", prepare: false, connect_timeout: 10 });

let failures = 0;
const check = (label, ok) => {
  console.log(`  ${ok ? "✓" : "✗"} ${label}`);
  if (!ok) failures++;
};

// Run a query block as the app role inside a transaction scoped to `orgId`.
const asTenant = (orgId, fn) =>
  app.begin(async (tx) => {
    await tx`select set_config('app.current_org_id', ${orgId}, true)`;
    return fn(tx);
  });

try {
  console.log("Role identity:");
  const [who] = await app`
    select current_user as u,
           (select rolbypassrls from pg_roles where rolname = current_user) as bypass
  `;
  check(`app connects as mallet_app (got "${who.u}")`, who.u === "mallet_app");
  check("app role has NOBYPASSRLS", who.bypass === false);

  console.log("Seeding two orgs with one lead each (as owner):");
  const [orgA] = await admin`insert into orgs (name) values ('RLS Proof Org A') returning id`;
  const [orgB] = await admin`insert into orgs (name) values ('RLS Proof Org B') returning id`;
  await admin`insert into leads (org_id, name) values (${orgA.id}, 'Alice (A)')`;
  await admin`insert into leads (org_id, name) values (${orgB.id}, 'Bob (B)')`;
  check("seeded org A + org B", Boolean(orgA.id && orgB.id));

  console.log("Isolation:");
  const unscoped = await app`select count(*)::int as n from leads`;
  check("unscoped app query sees 0 leads (fail-closed)", unscoped[0].n === 0);

  const aRows = await asTenant(orgA.id, (tx) => tx`select name, org_id from leads`);
  check("withTenant(A) sees exactly 1 lead", aRows.length === 1);
  check("withTenant(A) sees Alice only", aRows.length === 1 && aRows[0].name === "Alice (A)");
  check("withTenant(A) cannot see org B's row", !aRows.some((r) => r.org_id === orgB.id));

  const bRows = await asTenant(orgB.id, (tx) => tx`select name, org_id from leads`);
  check("withTenant(B) sees exactly 1 lead", bRows.length === 1);
  check("withTenant(B) sees Bob only", bRows.length === 1 && bRows[0].name === "Bob (B)");

  console.log("Write isolation:");
  let blocked = false;
  try {
    await asTenant(orgA.id, (tx) =>
      tx`insert into leads (org_id, name) values (${orgB.id}, 'Mallory')`,
    );
  } catch {
    blocked = true;
  }
  check("tenant A cannot insert a row tagged org B (WITH CHECK)", blocked);
  const [stray] = await admin`select count(*)::int as n from leads where name = 'Mallory'`;
  check("no cross-tenant write persisted", stray.n === 0);
} catch (e) {
  console.error("\nProof errored:", e.message);
  failures++;
} finally {
  await admin`delete from orgs where name in ('RLS Proof Org A', 'RLS Proof Org B')`;
  await admin.end({ timeout: 5 });
  await app.end({ timeout: 5 });
}

if (failures > 0) {
  console.error(`\n${failures} check(s) FAILED ✗`);
  process.exit(1);
}
console.log("\nALL RLS CHECKS PASSED ✓");
