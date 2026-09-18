#!/usr/bin/env node
/**
 * Delete a test org and its auth user, so the same inbox can sign up again.
 *
 * Testing onboarding means signing up repeatedly, and every run needs an email the auth provider
 * has not seen. Gmail plus-addressing solves the inbox side (you+shop1@gmail.com all arrive in one
 * place, and nothing in the signup path strips the "+" — only `.toLowerCase()` is applied). This
 * script solves the other side: without it every attempt leaves an org, a users row and a Supabase
 * auth identity behind, and the shared dev/prod database slowly fills with debris.
 *
 * Usage:
 *   node --env-file=.env.local scripts/drop-test-org.mjs you+shop1@gmail.com
 *   node --env-file=.env.local scripts/drop-test-org.mjs you+shop1@gmail.com --dry-run
 *
 * SAFETY. This database is SHARED with production. The script therefore:
 *   - takes an EMAIL, never an org id, so you cannot paste the wrong uuid and delete a real shop;
 *   - prints the org name, its user count and its job count, and refuses anything that looks
 *     established (see LOOKS_ESTABLISHED) unless you pass --force;
 *   - refuses outright if the email resolves to more than one org.
 */

import postgres from "postgres";

const email = process.argv[2]?.trim().toLowerCase();
const dryRun = process.argv.includes("--dry-run");
const force = process.argv.includes("--force");

if (!email || !email.includes("@")) {
  console.error("usage: node --env-file=.env.local scripts/drop-test-org.mjs <email> [--dry-run] [--force]");
  process.exit(1);
}

// A shop with real work in it is not a test org, whatever address created it.
const LOOKS_ESTABLISHED = (counts) => counts.jobs > 5 || counts.invoices > 0 || counts.users > 2;

const sql = postgres(process.env.DATABASE_URL, { max: 1, ssl: "require", prepare: false });

try {
  const users = await sql`
    select u.id as user_id, u.auth_user_id, u.org_id, o.name as org_name
    from users u join orgs o on o.id = u.org_id
    where lower(u.email) = ${email}`;

  if (users.length === 0) {
    console.log(`no user with email ${email} — nothing to do`);
    process.exit(0);
  }

  const orgIds = [...new Set(users.map((u) => u.org_id))];
  if (orgIds.length > 1) {
    console.error(`REFUSING: ${email} belongs to ${orgIds.length} orgs. Delete them by hand.`);
    process.exit(1);
  }

  const orgId = orgIds[0];
  const [counts] = await sql`
    select
      (select count(*) from users    where org_id = ${orgId})::int as users,
      (select count(*) from jobs     where org_id = ${orgId})::int as jobs,
      (select count(*) from leads    where org_id = ${orgId})::int as leads,
      (select count(*) from invoices where org_id = ${orgId})::int as invoices`;

  console.log(`org: ${users[0].org_name}  (${orgId})`);
  console.log(`     ${counts.users} users · ${counts.leads} customers · ${counts.jobs} jobs · ${counts.invoices} invoices`);

  if (LOOKS_ESTABLISHED(counts) && !force) {
    console.error("REFUSING: this org has real work in it. Re-run with --force if you are certain.");
    process.exit(1);
  }

  if (dryRun) {
    console.log("--dry-run: nothing deleted");
    process.exit(0);
  }

  // orgs cascades to every org-scoped table, which is why this is one statement and not twenty.
  await sql`delete from orgs where id = ${orgId}`;
  console.log(`deleted org ${orgId}`);

  // The Supabase auth identity lives in the auth schema and is NOT cascaded by the org delete.
  // Leaving it behind is what makes a re-signup with the same address silently do nothing.
  const authIds = users.map((u) => u.auth_user_id).filter(Boolean);
  if (authIds.length > 0) {
    await sql`delete from auth.users where id = any(${authIds})`;
    console.log(`deleted ${authIds.length} auth identity/identities — ${email} can sign up again`);
  } else {
    console.log("no auth identity linked; nothing further to clean");
  }
} catch (err) {
  console.error("failed:", err.message);
  process.exitCode = 1;
} finally {
  await sql.end({ timeout: 5 });
}
