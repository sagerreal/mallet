// Seed the E2E orgs + users. Requires .env.local (service role + DATABASE_URL).
//   node --env-file=.env.local scripts/seed-e2e.mjs                     # BOTH orgs
//   node --env-file=.env.local scripts/seed-e2e.mjs --empty-org         # only the empty one
//   node --env-file=.env.local scripts/seed-e2e.mjs --reset-passwords   # + repair credentials
//
// TWO FIXTURES, and the second one exists because the first can never be it.
//
// "E2E Plumbing" accumulates: every golden-path run adds a customer, a quote, a job and a bill,
// and that is exactly what makes it a good board fixture. A first-run screen is the opposite
// fixture — it only renders for a shop with nothing open AND no won history (the firstRun guard
// in app/(office)/dashboard/page.tsx) — so it needs an org that no test ever writes to.
// "E2E Fresh Plumbing" is that org: its owner sees the day-one board, and nothing else does.
//
// The DEFAULT run provisions BOTH, because the standing gate line is
//
//     pnpm seed:e2e && pnpm build && pnpm test:e2e
//
// and e2e/first-run.spec.ts is part of a plain `playwright test`. A seed that left the fresh org
// unmade would fail those four specs at the login step on any clean machine — a fixture gap that
// reads like a broken app. `--empty-org` remains as the standalone for re-making just that one.
import postgres from "postgres";
import { createClient } from "@supabase/supabase-js";

const ARGS = process.argv.slice(2);
/** Only the empty org. The default is both. */
const EMPTY_ONLY = ARGS.includes("--empty-org");
/**
 * Opt-in credential repair — see `ensureAuthUser`. OFF by default: a seed that silently reset
 * passwords would undo a real rotation on the shared Supabase project every time anyone ran it.
 */
const RESET_PASSWORDS = ARGS.includes("--reset-passwords");

/** The documented fixture password. Only ever written to an account this script CREATES. */
const PASSWORD = "e2e-password-1";

/**
 * The two fixtures. `env` names the override the e2e helpers read for that account
 * (e2e/helpers/ui.ts) — the one signal this script has that a human is running a rotated
 * password, and therefore must not touch it.
 */
const FIXTURES = [
  {
    org: "E2E Plumbing",
    seedLead: true,
    users: [
      { email: "owner@e2e.mallet.test", role: "owner", env: "E2E_OWNER_PASSWORD" },
      { email: "tech@e2e.mallet.test", role: "tech", env: "E2E_TECH_PASSWORD" },
    ],
  },
  {
    org: "E2E Fresh Plumbing",
    seedLead: false,
    users: [{ email: "owner@e2e-fresh.mallet.test", role: "owner", env: "E2E_FRESH_PASSWORD" }],
  },
];

const admin = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY);
const sql = postgres(process.env.DATABASE_URL, { ssl: "require", prepare: false, max: 1 });

/**
 * The account. Created with the fixture password; an EXISTING one is left alone unless asked.
 *
 * Why the flag exists: owner@e2e.mallet.test was reset through the Supabase admin API during a
 * manual walkthrough on 2026-08-04, and every visual, axe and golden run died at the login step
 * for days afterwards — the pre-merge gate for pixels and axe silently down. `--reset-passwords`
 * is the one-line repair for that.
 *
 * Why it is OFF by default, and why the env check outranks it even when it is on: these are live
 * accounts in a SHARED project. e2e/helpers/ui.ts reads `E2E_*_PASSWORD` precisely so a rotation
 * is a config change and the live password never lands in the repository — so if that variable is
 * set, somebody has rotated this account deliberately and resetting it to a literal published in
 * git would undo their rotation and re-publish the credential. The rotation wins.
 */
const ensureAuthUser = async ({ email, env }) => {
  const { data } = await admin.auth.admin.listUsers({ perPage: 1000 });
  const existing = data?.users.find((u) => u.email === email);
  if (!existing) {
    const { data: created, error } = await admin.auth.admin.createUser({ email, password: PASSWORD, email_confirm: true });
    if (error) throw error;
    return created.user.id;
  }

  if (!RESET_PASSWORDS) return existing.id;
  if (process.env[env]) {
    console.log(`  ${email}: password left alone — ${env} is set (a deliberate rotation outranks the flag)`);
    return existing.id;
  }
  const { error } = await admin.auth.admin.updateUserById(existing.id, { password: PASSWORD });
  if (error) throw error;
  console.log(`  ${email}: password reset to the fixture literal`);
  return existing.id;
};

/** Additive and idempotent: the org, its members, and (for the working fixture) one lead. */
async function seedFixture({ org: orgName, users, seedLead }) {
  let [org] = await sql`select id from orgs where name = ${orgName}`;
  if (!org) [org] = await sql`insert into orgs (name) values (${orgName}) returning id`;

  for (const u of users) {
    const authUserId = await ensureAuthUser(u);
    const isFieldCrew = u.role === "owner" || u.role === "tech";
    await sql`insert into users (org_id, auth_user_id, email, role, is_field_crew)
      values (${org.id}, ${authUserId}, ${u.email}, ${u.role}, ${isFieldCrew})
      on conflict (auth_user_id) do nothing`;
  }

  if (seedLead) {
    const [karen] = await sql`select id from leads where org_id = ${org.id} and name = 'E2E Karen'`;
    if (!karen) await sql`insert into leads (org_id, name, phone_e164) values (${org.id}, 'E2E Karen', '+15550100001')`;
    console.log(`seeded org ${org.id} ("${orgName}") with ${users.length} users`);
    return;
  }

  // Report rather than delete. The house rule is soft-delete only, and silently clearing rows
  // would hide the real problem: if this org has grown any work, some test is writing to the
  // fixture that exists to have none, and the first-run spec should fail loudly saying so.
  // Leads alone would do — a "won" lead needs an accepted estimate — but naming all four says
  // which surface leaked.
  const [rows] = await sql`
    select
      (select count(*) from leads where org_id = ${org.id} and deleted_at is null)::int as leads,
      (select count(*) from estimates where org_id = ${org.id} and deleted_at is null)::int as estimates,
      (select count(*) from jobs where org_id = ${org.id} and deleted_at is null)::int as jobs,
      (select count(*) from invoices where org_id = ${org.id} and deleted_at is null)::int as invoices`;
  const dirty = Object.entries(rows).filter(([, n]) => n > 0);
  console.log(`seeded EMPTY org ${org.id} ("${orgName}") with ${users.length} user(s)`);
  if (dirty.length > 0) {
    console.warn(
      `WARNING: the empty-org fixture is not empty — ${dirty.map(([k, n]) => `${k}=${n}`).join(", ")}. ` +
        `The first-run e2e will fail until this org is cleared.`,
    );
  }
}

try {
  for (const fixture of EMPTY_ONLY ? FIXTURES.filter((f) => !f.seedLead) : FIXTURES) {
    await seedFixture(fixture);
  }
} finally {
  await sql.end({ timeout: 5 });
}
