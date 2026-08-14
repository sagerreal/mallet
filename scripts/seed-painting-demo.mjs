#!/usr/bin/env node
/**
 * scripts/seed-painting-demo.mjs
 *
 * The painting shop we demo to painting companies — and the one the LiDAR room scan is shown on.
 *
 *   node --env-file=.env.local scripts/seed-painting-demo.mjs
 *   node --env-file=.env.local scripts/seed-painting-demo.mjs --dry-run
 *
 * WHY A COMMITTED SCRIPT. A demo shop assembled by hand in a psql session cannot be rebuilt the
 * morning of the next demo, and the one thing that must not happen on a call is a shop that is
 * half-populated because somebody pruned test data. This rebuilds it in about ten seconds with the
 * same logins, the same pricebook rates and the same job on today's board.
 *
 * WHAT MAKES THIS SHOP DIFFERENT FROM THE PLUMBING FIXTURES. Three things, and all three are
 * required for the scan to produce a price rather than a shrug:
 *
 *   1. `trade = 'painting'` and `measurement_estimating = true`. That org toggle defaults OFF and
 *      it is what renders the "Scan a room" row at all (lib/measurement-gate.ts) — a painting demo
 *      on a shop with it off shows nothing and looks broken.
 *   2. A pricebook whose services carry `measured_by`. A scan produces quantities (walls_sqft,
 *      ceiling_sqft, baseboard_lnft, crown_lnft, doors/windows counts); a service with no
 *      `measured_by` cannot be priced from them, so "Build the price" would come back empty. The
 *      rates here are the researched ones from app/(office)/settings/pricebooks/painting.ts.
 *   3. A job scheduled TODAY, assigned to the demo TECH, with an address. The scan is started from
 *      that job's Quote tab on the phone, so without it there is nothing to scan against.
 *
 * SAFETY. The database is SHARED dev/prod and holds real orgs. So: one org, identified by a stable
 * derived id, named in the WHERE clause of every statement; no DELETE outside this org's own child
 * rows; and a per-table row-count diff printed before and after, so another org appearing in it is
 * something you SEE rather than something you go looking for.
 *
 * IDEMPOTENT BY CONSTRUCTION. Every id is derived from a slug (`uuidFor`), so every write is an
 * upsert on the primary key and re-running converges on exactly the same shop.
 */

import { createHash } from "node:crypto";
import postgres from "postgres";
import { createClient } from "@supabase/supabase-js";

const DRY_RUN = process.argv.includes("--dry-run");

// A namespace of its own, so no id here can ever collide with the App Review shop's.
const ID_NAMESPACE = "mallet:painting-demo:v1";
const ORG_NAME = "Cedarline Painting";

const OWNER_EMAIL = "owner@paintingdemo.mallet.test";
const TECH_EMAIL = "tech@paintingdemo.mallet.test";
const DEMO_PASSWORD = "painting-demo-1";

function uuidFor(slug) {
  const digest = createHash("sha1").update(`${ID_NAMESPACE}:${slug}`).digest();
  const bytes = Buffer.from(digest.subarray(0, 16));
  bytes[6] = (bytes[6] & 0x0f) | 0x50; // version 5
  bytes[8] = (bytes[8] & 0x3f) | 0x80; // RFC 4122 variant
  const hex = bytes.toString("hex");
  return [hex.slice(0, 8), hex.slice(8, 12), hex.slice(12, 16), hex.slice(16, 20), hex.slice(20)].join("-");
}

const ORG_ID = uuidFor("org");
const idOf = (slug) => uuidFor(slug);

function requireEnv(name) {
  const value = process.env[name];
  if (!value) {
    console.error(`${name} is required — run with --env-file=.env.local`);
    process.exit(1);
  }
  return value;
}

const DATABASE_URL = requireEnv("DATABASE_URL");
const SUPABASE_URL = requireEnv("NEXT_PUBLIC_SUPABASE_URL");
const SERVICE_ROLE_KEY = requireEnv("SUPABASE_SERVICE_ROLE_KEY");

const sql = postgres(DATABASE_URL, { max: 1, ssl: "require", prepare: false });
const admin = createClient(SUPABASE_URL, SERVICE_ROLE_KEY, {
  auth: { autoRefreshToken: false, persistSession: false },
});

// ---------------------------------------------------------------------------
// The shop
// ---------------------------------------------------------------------------

/**
 * The pricebook, lifted from app/(office)/settings/pricebooks/painting.ts.
 *
 * `measuredBy` is the whole point: it is what lets a room scan become a priced line. The rates are
 * per UNIT of the measured quantity — $2.25 per square foot of GROSS WALL SURFACE, not floor area.
 */
const CATEGORIES = [
  { slug: "cat-interior", name: "Interior Walls & Ceilings", sort: 0 },
  { slug: "cat-trim", name: "Trim, Doors & Windows", sort: 1 },
  { slug: "cat-exterior", name: "Exterior", sort: 2 },
  { slug: "cat-prep", name: "Prep & Repair", sort: 3 },
];

const SERVICES = [
  { slug: "svc-walls", cat: "cat-interior", name: "Interior wall painting (2 coats)", price: 225, cost: 105, measuredBy: "walls_sqft" },
  { slug: "svc-ceiling", cat: "cat-interior", name: "Ceiling painting", price: 200, cost: 95, measuredBy: "ceiling_sqft" },
  // Priced ABOVE open wall: two planes meeting at an outside corner, cut in on both edges, worked
  // overhead. The scanner cannot see a soffit at all, so this is always the painter's own number.
  { slug: "svc-soffit", cat: "cat-interior", name: "Soffit / bulkhead painting", price: 315, cost: 145, measuredBy: "soffit_sqft" },
  { slug: "svc-wallpaper", cat: "cat-prep", name: "Wallpaper removal", price: 190, cost: 90, measuredBy: "walls_sqft" },
  { slug: "svc-popcorn", cat: "cat-prep", name: "Popcorn ceiling removal", price: 177, cost: 84, measuredBy: "ceiling_sqft" },
  { slug: "svc-base", cat: "cat-trim", name: "Baseboard / trim painting", price: 250, cost: 115, measuredBy: "baseboard_lnft" },
  { slug: "svc-crown", cat: "cat-trim", name: "Crown molding painting", price: 330, cost: 150, measuredBy: "crown_lnft" },
  { slug: "svc-door", cat: "cat-trim", name: "Interior door & frame painting", price: 12300, cost: 5200, measuredBy: "doors_count" },
  { slug: "svc-window", cat: "cat-trim", name: "Interior window trim & frame painting", price: 8750, cost: 3700, measuredBy: "windows_count" },
  { slug: "svc-ext-body", cat: "cat-exterior", name: "Exterior house painting", price: 300, cost: 140, measuredBy: "site_sqft" },
  { slug: "svc-ext-wash", cat: "cat-exterior", name: "Exterior power washing (pre-paint prep)", price: 16, cost: 7, measuredBy: "site_sqft" },
  { slug: "svc-ext-trim", cat: "cat-exterior", name: "Exterior trim / fascia / soffit painting", price: 388, cost: 175, measuredBy: "site_lnft" },
  // Not measured: priced per job or per hour, and deliberately kept so the pricebook does not read
  // as if everything comes off a scanner.
  { slug: "svc-color", cat: "cat-prep", name: "Colour consultation", price: 15000, cost: 0, measuredBy: null },
  { slug: "svc-drywall", cat: "cat-prep", name: "Drywall patch & texture match", price: 9500, cost: 4200, measuredBy: null },
  { slug: "svc-cabinet", cat: "cat-interior", name: "Cabinet refinishing (per door/drawer front)", price: 11000, cost: 4800, measuredBy: null },
  { slug: "svc-labor", cat: "cat-prep", name: "Painter labour", price: 8500, cost: 4100, measuredBy: "hour" },
  { slug: "svc-deck", cat: "cat-exterior", name: "Deck staining & sealing", price: 285, cost: 130, measuredBy: "site_sqft" },
];

/**
 * The front desk's playbook. Painting is an ESTIMATE trade — almost nothing is a flat price over
 * the phone, so most lanes are "estimate" and the visit that follows is the one being scanned.
 */
const BOOKING = {
  services: [
    { name: "Interior repaint estimate", lane: "estimate", triggers: "paint my living room, repaint inside, interior painting" },
    { name: "Exterior repaint estimate", lane: "estimate", triggers: "paint the outside, exterior painting, house needs painting" },
    { name: "Cabinet refinishing estimate", lane: "estimate", triggers: "kitchen cabinets, refinish cabinets" },
    { name: "Drywall patch & touch-up", lane: "repair", price: 95, triggers: "hole in the wall, patch, touch up" },
    { name: "Colour consultation", lane: "flat", price: 150, triggers: "help me pick a colour, colour consult" },
  ],
  notServices: "roofing, flooring, epoxy garage floors",
  serviceFee: 0,
  feeCredited: false,
};

/**
 * WHAT THE SHOP BUYS, in the unit the supplier sells it in — the same list the painting trade pack
 * seeds (app/(office)/settings/pricebooks/painting.ts), repeated here because this org already has
 * services and the seed endpoint is idempotent by design: it no-ops the moment a book has one
 * line, so it can never top up an existing shop.
 *
 * Coverage is in every description because it is the number the demo turns on: one gallon covers
 * ~350 sq ft per coat, so a scanned 210 sq ft bathroom at two coats is 1.2 gallons — two cans,
 * because paint is not sold by the fifth.
 *
 * sell = cost here (markup_bps null → the org default applies at quote time); the seed does not
 * invent this shop's margin.
 */
const MATERIALS = [
  { slug: "mat-eggshell", name: "Interior latex, eggshell", uom: "gal", cost: 3800, cat: "cat-interior", desc: "Walls. Covers ~350 sq ft per coat." },
  { slug: "mat-flat", name: "Interior latex, flat", uom: "gal", cost: 3000, cat: "cat-interior", desc: "Ceilings. Covers ~350 sq ft per coat." },
  { slug: "mat-semigloss", name: "Interior latex, semi-gloss", uom: "gal", cost: 4200, cat: "cat-trim", desc: "Trim, doors, cabinets. Covers ~350 sq ft per coat." },
  { slug: "mat-pva", name: "Drywall primer (PVA)", uom: "gal", cost: 2200, cat: "cat-prep", desc: "New or patched drywall. Covers ~300 sq ft." },
  { slug: "mat-blocker", name: "Stain-blocking primer", uom: "gal", cost: 3800, cat: "cat-prep", desc: "Water stains, smoke, dark-to-light colour changes. Covers ~300 sq ft." },
  { slug: "mat-ext", name: "Exterior acrylic, satin", uom: "gal", cost: 5200, cat: "cat-exterior", desc: "Exterior body and trim. Covers ~300 sq ft per coat on smooth siding." },
  { slug: "mat-caulk", name: "Painter's caulk", uom: "tube", cost: 350, cat: "cat-prep", desc: "Trim-to-wall seams. One tube runs ~40 ln ft." },
  { slug: "mat-spackle", name: "Spackle / patching compound", uom: "qt", cost: 800, cat: "cat-prep", desc: "Nail holes and small dings." },
  { slug: "mat-tape", name: "Painter's tape, 1.88 in", uom: "roll", cost: 750, cat: "cat-prep", desc: "60 yd per roll." },
  { slug: "mat-film", name: "Masking film", uom: "roll", cost: 1800, cat: "cat-prep", desc: "Pre-taped plastic for cabinets, windows and floors." },
  { slug: "mat-drop", name: "Canvas drop cloth, 9x12", uom: "each", cost: 2400, cat: "cat-prep", desc: "Reusable — costed per job at roughly a tenth of replacement." },
  { slug: "mat-roller", name: "Roller cover, 3/8 in nap", uom: "each", cost: 600, cat: "cat-prep", desc: "One per colour per day on smooth walls." },
  { slug: "mat-sand", name: "Sandpaper, assorted grit", uom: "pack", cost: 900, cat: "cat-prep", desc: "Scuff-sanding trim and patched areas." },
];

const CUSTOMERS = [
  { slug: "cust-ruiz", name: "Marisol Ruiz", phone: "+15105550142", email: "m.ruiz@example.com", address: "418 Ravenwood Ave, Oakland, CA 94610", stage: "won", source: "Referral", valueCents: 486000 },
  { slug: "cust-tan", name: "Peter Tan", phone: "+14155550188", email: "ptan@example.com", address: "77 Sutro Heights Ln, San Francisco, CA 94121", stage: "quote_sent", source: "Google", valueCents: 312000 },
  { slug: "cust-oakhill", name: "Oak Hill Property Group", phone: "+19255550119", email: "maint@oakhillpg.example.com", address: "2200 Crow Canyon Pl, San Ramon, CA 94583", stage: "new", source: "Repeat customer", valueCents: 0 },
  { slug: "cust-delgado", name: "Ana Delgado", phone: "+15105550173", email: "ana.d@example.com", address: "9 Bayberry Ct, Alameda, CA 94502", stage: "new", source: "Nextdoor / FB", valueCents: 0 },
];

/**
 * Today's board for the demo tech.
 *
 * The FIRST job is the one the scan is demonstrated on: scheduled today, assigned to the tech, with
 * a real address, and left `scheduled` so the phone shows it as the next stop rather than as
 * finished work.
 */
const JOBS = [
  {
    slug: "job-ruiz-interior", num: "JOB-2001", customer: "cust-ruiz", assignee: "user-tech",
    title: "Interior repaint — living, dining, hall", svc: "Interior painting", kind: "estimate",
    status: "scheduled", dayOffset: 0, startHour: 9, durationMinutes: 180,
    addr: "418 Ravenwood Ave, Oakland, CA 94610",
    scope: "Walk the three rooms and scan each one. Customer is deciding between one and two accent walls.",
  },
  {
    slug: "job-tan-exterior", num: "JOB-2002", customer: "cust-tan", assignee: "user-tech",
    title: "Exterior body & trim — two storey", svc: "Exterior painting", kind: "estimate",
    status: "scheduled", dayOffset: 0, startHour: 13, durationMinutes: 120,
    addr: "77 Sutro Heights Ln, San Francisco, CA 94121",
    scope: "South elevation has sun damage. Measure trim separately from body.",
  },
  {
    slug: "job-oakhill-units", num: "JOB-2003", customer: "cust-oakhill", assignee: "user-tech",
    title: "Unit turnover — 4 apartments", svc: "Interior painting", kind: "work",
    status: "scheduled", dayOffset: 1, startHour: 8, durationMinutes: 480,
    addr: "2200 Crow Canyon Pl, San Ramon, CA 94583",
    scope: "Standard turnover: walls and ceilings, no trim unless damaged.",
  },
];

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

const pad = (n) => String(n).padStart(2, "0");

/** A date `offset` days from today, as YYYY-MM-DD in the shop's own zone (Pacific). */
function orgDate(offset) {
  const now = new Date();
  const local = new Date(now.toLocaleString("en-US", { timeZone: "America/Los_Angeles" }));
  local.setDate(local.getDate() + offset);
  return `${local.getFullYear()}-${pad(local.getMonth() + 1)}-${pad(local.getDate())}`;
}

const timeLiteral = (hour) => `${pad(Math.floor(hour))}:${pad(Math.round((hour % 1) * 60))}:00`;

const TABLES = ["orgs", "org_settings", "users", "leads", "jobs", "job_visits", "pricebook_categories", "pricebook_items", "pricebook_materials"];

/** Row counts for THIS org, plus a total, so a stray write into another org is visible. */
async function snapshot() {
  const out = {};
  for (const t of TABLES) {
    const col = t === "orgs" ? "id" : "org_id";
    const [mine] = await sql`select count(*)::int as n from ${sql(t)} where ${sql(col)} = ${ORG_ID}`;
    const [all] = await sql`select count(*)::int as n from ${sql(t)}`;
    out[t] = { mine: mine.n, all: all.n };
  }
  return out;
}

function printDiff(before, after) {
  console.log("\n  table                    this org        whole db");
  for (const t of TABLES) {
    const b = before[t], a = after[t];
    const mine = a.mine - b.mine, all = a.all - b.all;
    const drift = all !== mine ? "   ← OTHER ORGS CHANGED" : "";
    console.log(`  ${t.padEnd(22)} ${String(a.mine).padStart(4)} (${mine >= 0 ? "+" : ""}${mine})   ${String(a.all).padStart(6)} (${all >= 0 ? "+" : ""}${all})${drift}`);
  }
}

/**
 * An auth user that can sign in immediately.
 *
 * `email_confirm: true` matters: nobody is clicking a confirmation link mid-demo, and a shop whose
 * logins need a mailbox is a shop that cannot be demoed.
 */
async function ensureAuthUser(email) {
  const { data: list } = await admin.auth.admin.listUsers({ page: 1, perPage: 1000 });
  const existing = list?.users?.find((u) => u.email?.toLowerCase() === email.toLowerCase());
  if (existing) {
    await admin.auth.admin.updateUserById(existing.id, { password: DEMO_PASSWORD, email_confirm: true });
    return existing.id;
  }
  const { data: created, error } = await admin.auth.admin.createUser({
    email,
    password: DEMO_PASSWORD,
    email_confirm: true,
  });
  if (error) throw new Error(`createUser(${email}) failed: ${error.message}`);
  return created.user.id;
}

// ---------------------------------------------------------------------------
// Writers
// ---------------------------------------------------------------------------

async function writeOrg() {
  await sql`
    insert into orgs (id, name) values (${ORG_ID}, ${ORG_NAME})
    on conflict (id) do update set name = excluded.name`;
}

async function writeSettings() {
  await sql`
    insert into org_settings (
      id, org_id, trade, markup_bps, timezone, measurement_estimating,
      tech_sees_price, tech_texts, front_desk, scope_on, auto_remind,
      brand_tagline, brand_color, brand_initials,
      hours_wd_open, hours_wd_close, hours_sat_open, hours_sat_close, hours_sun_open, hours_sun_close,
      booking, updated_at
    ) values (
      ${idOf("settings")}, ${ORG_ID}, 'painting', 3500, 'America/Los_Angeles', true,
      true, true, false, true, true,
      'Clean lines, on time', '#2F4B7C', 'CP',
      7, 17, 8, 14, 0, 0,
      ${JSON.stringify(BOOKING)}, now()
    )
    on conflict (org_id) do update set
      trade = excluded.trade,
      timezone = excluded.timezone,
      -- The gate the whole demo depends on. Re-asserted on every run so a toggle flipped during a
      -- previous demo cannot leave the next one showing no scan row.
      measurement_estimating = excluded.measurement_estimating,
      tech_sees_price = excluded.tech_sees_price,
      brand_tagline = excluded.brand_tagline,
      brand_color = excluded.brand_color,
      brand_initials = excluded.brand_initials,
      updated_at = now()`;
}

async function writeUsers() {
  const owner = { slug: "user-owner", email: OWNER_EMAIL, name: "Dana Cortez", role: "owner", crew: false };
  const tech = { slug: "user-tech", email: TECH_EMAIL, name: "Luis Marchetti", role: "tech", crew: true };

  for (const u of [owner, tech]) {
    const authId = await ensureAuthUser(u.email);
    await sql`
      insert into users (id, org_id, auth_user_id, email, name, role, is_field_crew, cost_rate_cents)
      values (${idOf(u.slug)}, ${ORG_ID}, ${authId}, ${u.email}, ${u.name}, ${u.role}, ${u.crew},
              ${u.crew ? 3400 : null})
      on conflict (id) do update set
        auth_user_id = excluded.auth_user_id, email = excluded.email, name = excluded.name,
        role = excluded.role, is_field_crew = excluded.is_field_crew,
        cost_rate_cents = excluded.cost_rate_cents`;
  }
}

async function writePricebook() {
  for (const c of CATEGORIES) {
    await sql`
      insert into pricebook_categories (id, org_id, name, sort_order)
      values (${idOf(c.slug)}, ${ORG_ID}, ${c.name}, ${c.sort})
      on conflict (id) do update set name = excluded.name, sort_order = excluded.sort_order`;
  }
  let position = 0;
  for (const s of SERVICES) {
    await sql`
      insert into pricebook_items (
        id, org_id, category_id, label, unit_price_cents, cost_cents, position, measured_by
      ) values (
        ${idOf(s.slug)}, ${ORG_ID}, ${idOf(s.cat)}, ${s.name},
        ${s.price}, ${s.cost}, ${position++}, ${s.measuredBy}
      )
      on conflict (id) do update set
        category_id = excluded.category_id, label = excluded.label,
        unit_price_cents = excluded.unit_price_cents, cost_cents = excluded.cost_cents,
        position = excluded.position, measured_by = excluded.measured_by`;
  }
  let matPosition = 0;
  for (const m of MATERIALS) {
    await sql`
      insert into pricebook_materials (
        id, org_id, category_id, name, description, unit_cost_cents, unit_price_cents,
        unit_of_measure, position
      ) values (
        ${idOf(m.slug)}, ${ORG_ID}, ${idOf(m.cat)}, ${m.name}, ${m.desc},
        ${m.cost}, ${m.cost}, ${m.uom}, ${matPosition++}
      )
      on conflict (id) do update set
        category_id = excluded.category_id, name = excluded.name,
        description = excluded.description, unit_cost_cents = excluded.unit_cost_cents,
        unit_price_cents = excluded.unit_price_cents,
        unit_of_measure = excluded.unit_of_measure, position = excluded.position`;
  }
}

async function writeCustomers() {
  for (const c of CUSTOMERS) {
    await sql`
      insert into leads (id, org_id, name, phone_e164, email, address, stage, source, value_cents, updated_at)
      values (${idOf(c.slug)}, ${ORG_ID}, ${c.name}, ${c.phone}, ${c.email}, ${c.address},
              ${c.stage}, ${c.source}, ${c.valueCents}, now())
      on conflict (id) do update set
        name = excluded.name, phone_e164 = excluded.phone_e164, email = excluded.email,
        address = excluded.address, stage = excluded.stage, source = excluded.source,
        value_cents = excluded.value_cents, updated_at = now()`;
  }
}

async function writeJobs() {
  for (const j of JOBS) {
    const date = orgDate(j.dayOffset);
    const start = `${date}T${timeLiteral(j.startHour)}`;
    const end = `${date}T${timeLiteral(j.startHour + j.durationMinutes / 60)}`;
    await sql`
      insert into jobs (
        id, org_id, num, lead_id, assignee_user_id, title, svc, kind, status,
        scheduled_start, scheduled_end, total_cents, scope, addr, updated_at
      ) values (
        ${idOf(j.slug)}, ${ORG_ID}, ${j.num}, ${idOf(j.customer)}, ${idOf(j.assignee)},
        ${j.title}, ${j.svc}, ${j.kind}, ${j.status},
        ${start}, ${end}, 0, ${j.scope}, ${j.addr}, now()
      )
      on conflict (id) do update set
        num = excluded.num, lead_id = excluded.lead_id, assignee_user_id = excluded.assignee_user_id,
        title = excluded.title, svc = excluded.svc, kind = excluded.kind, status = excluded.status,
        scheduled_start = excluded.scheduled_start, scheduled_end = excluded.scheduled_end,
        scope = excluded.scope, addr = excluded.addr, updated_at = now()`;

    await sql`
      insert into job_visits (
        id, org_id, job_id, assignee_user_id, scheduled_date, scheduled_start, scheduled_end,
        duration_minutes, status, notes, position, updated_at
      ) values (
        ${idOf(`${j.slug}-visit`)}, ${ORG_ID}, ${idOf(j.slug)}, ${idOf(j.assignee)},
        ${date}, ${timeLiteral(j.startHour)}, ${timeLiteral(j.startHour + j.durationMinutes / 60)},
        ${j.durationMinutes}, 'pending', ${j.scope}, 0, now()
      )
      on conflict (id) do update set
        assignee_user_id = excluded.assignee_user_id, scheduled_date = excluded.scheduled_date,
        scheduled_start = excluded.scheduled_start, scheduled_end = excluded.scheduled_end,
        duration_minutes = excluded.duration_minutes, status = excluded.status,
        notes = excluded.notes, updated_at = now()`;
  }
}

// ---------------------------------------------------------------------------
// Run
// ---------------------------------------------------------------------------

async function main() {
  console.log(`\n${ORG_NAME}  (org ${ORG_ID})`);
  if (DRY_RUN) {
    console.log("\n--dry-run: nothing will be written.\n");
    console.log(`  ${CATEGORIES.length} categories, ${SERVICES.length} services, ${MATERIALS.length} materials ` +
      `(${SERVICES.filter((s) => s.measuredBy && s.measuredBy !== "hour").length} priced off a scan)`);
    console.log(`  ${CUSTOMERS.length} customers, ${JOBS.length} jobs`);
    console.log(`  logins: ${OWNER_EMAIL} / ${TECH_EMAIL}  (password ${DEMO_PASSWORD})\n`);
    await sql.end();
    return;
  }

  const before = await snapshot();
  await writeOrg();
  await writeSettings();
  await writeUsers();
  await writePricebook();
  await writeCustomers();
  await writeJobs();
  const after = await snapshot();

  printDiff(before, after);

  console.log(`\n  Office:  ${OWNER_EMAIL}`);
  console.log(`  Phone:   ${TECH_EMAIL}`);
  console.log(`  Password: ${DEMO_PASSWORD}`);
  console.log(`\n  Today's board for the tech: ${JOBS.filter((j) => j.dayOffset === 0).length} jobs.`);
  console.log(`  Scan lives on the job's Quote tab — NATIVE APP ONLY (LiDAR), not mobile Safari.\n`);

  await sql.end();
}

main().catch(async (error) => {
  console.error("\nseed failed:", error.message);
  await sql.end({ timeout: 5 }).catch(() => {});
  process.exit(1);
});
