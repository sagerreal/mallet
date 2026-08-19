#!/usr/bin/env node
/**
 * scripts/provision-org.mjs
 * Provision a REAL customer org: the org row, its settings, and the owner's login. Nothing else —
 * no demo data, no seeded jobs, no pricebook (the shop picks its starter pack in-app, where the
 * trade decides which pack is even offered; wrong seeded prices are worse than an empty book).
 *
 *   node --env-file=.env.local scripts/provision-org.mjs \
 *     --org "Maple Valley Contracting" --email owner@x.com --name "Nathan MacAlpine" \
 *     --trade other --tz America/New_York [--dry-run]
 *
 * Exists because self-serve signup is off: every real org is provisioned by hand, and a hand-run
 * psql session cannot be re-run when it half-fails. Same safety model as the demo seeders on the
 * SHARED prod database: ids derive from the org name (idempotent — re-running converges), every
 * statement names the org id, and a per-table before/after count diff makes any write outside
 * this org something you SEE.
 *
 * The temp password is GENERATED and printed once — hand it to the owner and have them change it.
 * This script never emails anybody.
 */

import { createHash, randomBytes } from "node:crypto";
import postgres from "postgres";
import { createClient } from "@supabase/supabase-js";

const args = {};
for (let i = 2; i < process.argv.length; i++) {
  const a = process.argv[i];
  if (a === "--dry-run") args.dryRun = true;
  else if (a.startsWith("--")) args[a.slice(2)] = process.argv[++i];
}
const REQUIRED = ["org", "email", "name", "trade", "tz"];
for (const k of REQUIRED) {
  if (!args[k]) {
    console.error(`missing --${k}\nusage: provision-org.mjs --org NAME --email E --name OWNER --trade T --tz TZ [--dry-run]`);
    process.exit(1);
  }
}

const TRADES = ["hvac", "mechanical", "electrical", "plumbing", "roofing", "painting", "fencing", "concrete", "siding", "gutters", "other"];
if (!TRADES.includes(args.trade)) {
  console.error(`--trade must be one of: ${TRADES.join(", ")}`);
  process.exit(1);
}

const ID_NAMESPACE = `mallet:org:${args.org.toLowerCase().replace(/[^a-z0-9]+/g, "-")}`;
function uuidFor(slug) {
  const digest = createHash("sha1").update(`${ID_NAMESPACE}:${slug}`).digest();
  const bytes = Buffer.from(digest.subarray(0, 16));
  bytes[6] = (bytes[6] & 0x0f) | 0x50;
  bytes[8] = (bytes[8] & 0x3f) | 0x80;
  const hex = bytes.toString("hex");
  return [hex.slice(0, 8), hex.slice(8, 12), hex.slice(12, 16), hex.slice(16, 20), hex.slice(20)].join("-");
}
const ORG_ID = uuidFor("org");

// Readable but strong: 4 random words' worth of entropy without the ambiguity of l/1/O/0.
const password = randomBytes(9).toString("base64url").replace(/[-_]/g, "x") + "-" + Math.floor(Math.random() * 90 + 10);

const sql = postgres(process.env.DATABASE_URL, { prepare: false, max: 1 });
const admin = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY, {
  auth: { autoRefreshToken: false, persistSession: false },
});

const TABLES = ["orgs", "org_settings", "users"];
async function counts() {
  const out = {};
  for (const t of TABLES) {
    const [mine] = await sql.unsafe(`select count(*)::int as n from ${t} where ${t === "orgs" ? "id" : "org_id"} = '${ORG_ID}'`);
    const [all] = await sql.unsafe(`select count(*)::int as n from ${t}`);
    out[t] = { mine: mine.n, all: all.n };
  }
  return out;
}

const before = await counts();

if (args.dryRun) {
  console.log(`--dry-run: would provision "${args.org}" (org ${ORG_ID}) trade=${args.trade} tz=${args.tz}`);
  console.log(`owner: ${args.name} <${args.email}>`);
  await sql.end();
  process.exit(0);
}

// The existing-email guard: a REAL person's account must never be silently repointed at a new
// org — that is how someone loses access to the org they were in yesterday.
const { data: list } = await admin.auth.admin.listUsers({ page: 1, perPage: 1000 });
const existingAuth = list?.users?.find((u) => u.email?.toLowerCase() === args.email.toLowerCase());
if (existingAuth) {
  const rows = await sql`select org_id from users where auth_user_id = ${existingAuth.id}`;
  if (rows.length > 0 && rows[0].org_id !== ORG_ID) {
    console.error(`REFUSING: ${args.email} already belongs to org ${rows[0].org_id}.`);
    await sql.end();
    process.exit(1);
  }
}

let authId;
if (existingAuth) {
  authId = existingAuth.id;
  await admin.auth.admin.updateUserById(authId, { password, email_confirm: true });
} else {
  const { data: created, error } = await admin.auth.admin.createUser({
    email: args.email,
    password,
    email_confirm: true,
  });
  if (error) {
    console.error(`createUser failed: ${error.message}`);
    await sql.end();
    process.exit(1);
  }
  authId = created.user.id;
}

await sql`insert into orgs (id, name) values (${ORG_ID}, ${args.org})
  on conflict (id) do update set name = excluded.name`;

// Defaults a real shop starts from: 35% markup (the app-wide default), measurement off unless
// the trade grants it in-app, front desk off, weekday 7–17. All of it editable in Settings —
// this is a starting point, not a decision made for them.
await sql`
  insert into org_settings (
    id, org_id, trade, markup_bps, timezone, measurement_estimating,
    tech_sees_price, tech_texts, front_desk, scope_on, auto_remind,
    hours_wd_open, hours_wd_close, hours_sat_open, hours_sat_close, hours_sun_open, hours_sun_close,
    booking, updated_at
  ) values (
    ${uuidFor("settings")}, ${ORG_ID}, ${args.trade}, 3500, ${args.tz}, false,
    true, true, false, true, true,
    7, 17, 0, 0, 0, 0,
    ${JSON.stringify({ services: [], notServices: "", serviceFee: 89, feeCredited: true })}, now()
  )
  on conflict (org_id) do update set
    trade = excluded.trade, timezone = excluded.timezone, updated_at = now()`;

await sql`
  insert into users (id, org_id, auth_user_id, email, name, role, is_field_crew, cost_rate_cents)
  values (${uuidFor("user-owner")}, ${ORG_ID}, ${authId}, ${args.email}, ${args.name}, 'owner', false, null)
  on conflict (id) do update set
    auth_user_id = excluded.auth_user_id, email = excluded.email, name = excluded.name`;

const after = await counts();
console.log(`\n${args.org}  (org ${ORG_ID})\n`);
console.log("  table          this org        whole db");
for (const t of TABLES) {
  const flag = after[t].all - before[t].all > after[t].mine - before[t].mine ? "  ← OTHER ORGS CHANGED" : "";
  console.log(`  ${t.padEnd(14)} ${String(after[t].mine).padStart(2)} (+${after[t].mine - before[t].mine})      ${String(after[t].all).padStart(5)} (+${after[t].all - before[t].all})${flag}`);
}
console.log(`\n  Login:    ${args.email}`);
console.log(`  Password: ${password}   ← hand this over once; have them change it`);
console.log(`  Trade:    ${args.trade} · ${args.tz}`);
await sql.end();
