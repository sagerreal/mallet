// Seed the E2E org + users. Requires .env.local (service role + DATABASE_URL).
//   node --env-file=.env.local scripts/seed-e2e.mjs
//   node --env-file=.env.local scripts/seed-e2e.mjs --empty-org
//
// TWO FIXTURES, and the second one exists because the first can never be it.
//
// "E2E Plumbing" accumulates: every golden-path run adds a customer, a quote, a job and a bill,
// and that is exactly what makes it a good board fixture. A first-run screen is the opposite
// fixture — it only renders for a shop with nothing open AND no won history (features/board
// firstRun guard) — so it needs an org that no test ever writes to. `--empty-org` provisions
// that org and its owner and writes NOTHING else: no leads, no jobs, no estimates, no invoices.
// It is additive and idempotent, like the main path.
import postgres from "postgres";
import { createClient } from "@supabase/supabase-js";

const EMPTY_ORG = process.argv.includes("--empty-org");

const PASSWORD = "e2e-password-1";
const ORG_NAME = EMPTY_ORG ? "E2E Fresh Plumbing" : "E2E Plumbing";
const USERS = EMPTY_ORG
  ? [{ email: "owner@e2e-fresh.mallet.test", role: "owner" }]
  : [
      { email: "owner@e2e.mallet.test", role: "owner" },
      { email: "tech@e2e.mallet.test", role: "tech" },
    ];

const admin = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY);
const sql = postgres(process.env.DATABASE_URL, { ssl: "require", prepare: false, max: 1 });

/**
 * The account, with the password this repo's e2e helpers actually use.
 *
 * The reset on an EXISTING user is the point, not belt-and-braces. owner@e2e.mallet.test was
 * reset through the Supabase admin API during a manual walkthrough on 2026-08-04 and every
 * visual, axe and golden run has died at the login step since, with "Email or password is
 * incorrect" — the pre-merge gate for pixels and axe silently down, in a way that reads like a
 * broken app (see the note on OWNER in e2e/helpers/ui.ts). Seeding used to create-or-skip, so
 * re-seeding could not repair it and nothing else would.
 *
 * These are fixture accounts in the shared dev project and the literal is the documented one, so
 * `npm run seed:e2e` — already the first half of the e2e gate — now also guarantees the
 * credentials the nets sign in with.
 */
const ensureAuthUser = async (email) => {
  const { data } = await admin.auth.admin.listUsers({ perPage: 1000 });
  const existing = data?.users.find((u) => u.email === email);
  if (existing) {
    const { error } = await admin.auth.admin.updateUserById(existing.id, { password: PASSWORD });
    if (error) throw error;
    return existing.id;
  }
  const { data: created, error } = await admin.auth.admin.createUser({ email, password: PASSWORD, email_confirm: true });
  if (error) throw error;
  return created.user.id;
};

try {
  let [org] = await sql`select id from orgs where name = ${ORG_NAME}`;
  if (!org) [org] = await sql`insert into orgs (name) values (${ORG_NAME}) returning id`;

  for (const u of USERS) {
    const authUserId = await ensureAuthUser(u.email);
    const isFieldCrew = u.role === "owner" || u.role === "tech";
    await sql`insert into users (org_id, auth_user_id, email, role, is_field_crew)
      values (${org.id}, ${authUserId}, ${u.email}, ${u.role}, ${isFieldCrew})
      on conflict (auth_user_id) do nothing`;
  }

  if (EMPTY_ORG) {
    // Report rather than delete. The house rule is soft-delete only, and silently clearing rows
    // would hide the real problem: if this org has grown any work, some test is writing to the
    // fixture that exists to have none, and the first-run spec should fail loudly saying so.
    const [rows] = await sql`
      select
        (select count(*) from leads where org_id = ${org.id} and deleted_at is null)::int as leads,
        (select count(*) from estimates where org_id = ${org.id} and deleted_at is null)::int as estimates,
        (select count(*) from jobs where org_id = ${org.id} and deleted_at is null)::int as jobs,
        (select count(*) from invoices where org_id = ${org.id} and deleted_at is null)::int as invoices`;
    const dirty = Object.entries(rows).filter(([, n]) => n > 0);
    console.log(`seeded EMPTY org ${org.id} ("${ORG_NAME}") with ${USERS.length} user(s)`);
    if (dirty.length > 0) {
      console.warn(
        `WARNING: the empty-org fixture is not empty — ${dirty.map(([k, n]) => `${k}=${n}`).join(", ")}. ` +
          `The first-run e2e will fail until this org is cleared.`,
      );
    }
  } else {
    const [karen] = await sql`select id from leads where org_id = ${org.id} and name = 'E2E Karen'`;
    if (!karen) await sql`insert into leads (org_id, name, phone_e164) values (${org.id}, 'E2E Karen', '+15550100001')`;

    console.log(`seeded org ${org.id} with ${USERS.length} users`);
  }
} finally {
  await sql.end({ timeout: 5 });
}
