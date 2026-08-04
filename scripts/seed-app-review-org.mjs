#!/usr/bin/env node
/**
 * scripts/seed-app-review-org.mjs
 *
 * Builds the shop that Apple's App Review team signs into.
 *
 * WHY THIS IS A COMMITTED SCRIPT AND NOT A ONE-OFF. Every resubmission needs the demo
 * account to still work, and a rejection is usually followed by a build change and another
 * submission days later. A shop hand-assembled in a psql session cannot be restored after
 * someone prunes test data; this can, in about ten seconds, with the same credentials.
 *
 *   node --env-file=.env.local scripts/seed-app-review-org.mjs
 *   node --env-file=.env.local scripts/seed-app-review-org.mjs --dry-run
 *
 * SAFETY. The database is SHARED dev/prod and contains real orgs. This script therefore:
 *   - creates ONE org, identified by name (scripts/app-review/shop-data.mjs ORG_NAME), and
 *     names its id in the WHERE clause of every statement it runs;
 *   - never issues a DELETE against anything but its OWN org's child rows;
 *   - snapshots per-org row counts for every table it touches BEFORE and AFTER, and prints
 *     a diff. Any org other than this one appearing in that diff is a bug in this file, and
 *     you will see it rather than have to go looking for it.
 *
 * IDEMPOTENT BY CONSTRUCTION. Every row's primary key is derived from a stable slug
 * (`uuidFor`), so every write is `insert … on conflict (id) do update` and re-running
 * converges onto exactly the same shop instead of minting a second one. Child collections
 * (lines, visits) are replaced wholesale under their parent id, which is what keeps an
 * edited fixture from leaving orphaned rows behind.
 *
 * EMAIL VERIFICATION. A reviewer cannot click a confirmation link in Owen's inbox, so the
 * owner account is created through the Supabase Admin API with `email_confirm: true`, which
 * lands the identity already verified and able to sign in with a password immediately. This
 * is the same mechanism scripts/seed-e2e.mjs uses. Re-running also RESETS the password, so
 * the credential in docs/app-review-notes.md is always the live one.
 *
 * DATABASE_URL (the owner role, RLS-exempt) is required — not APP_DATABASE_URL. Seeding
 * writes across every tenant table before any session principal exists, which is precisely
 * what the RLS-bound role is there to prevent.
 */

import { createHash } from "node:crypto";
import postgres from "postgres";
import { createClient } from "@supabase/supabase-js";
import {
  ORG_NAME,
  OWNER_EMAIL,
  ORG_TIMEZONE,
  SETTINGS,
  CREW,
  LEAD_SOURCES,
  LABOR_RATES,
  CUSTOMERS,
  PRICEBOOK_CATEGORIES,
  PRICEBOOK_ITEMS,
  JOBS,
  QUOTES,
  INVOICES,
  SEQUENCE_START,
} from "./app-review/shop-data.mjs";

// ---------------------------------------------------------------------------
// Configuration
// ---------------------------------------------------------------------------

/**
 * The reviewer's password.
 *
 * Deliberately a constant in a committed file, and deliberately not treated as a secret:
 * its whole purpose is to be pasted into App Store Connect's App Review Information field,
 * where it is read by strangers, and to be reproduced byte-for-byte by a re-run months
 * later so the notes Apple already has stay valid. A generated-per-run password would
 * silently invalidate the submission.
 *
 * It is scoped to a demo org that holds no real customer data, no payment credentials and
 * no connected accounts, and it is used nowhere else. Override with APP_REVIEW_PASSWORD if
 * you would rather it never touched git.
 */
const PASSWORD = process.env.APP_REVIEW_PASSWORD ?? "Ridgeline-Review-7Q4t!2846";

const DRY = process.argv.includes("--dry-run");

/** Namespace for the deterministic ids. Changing it re-keys the ENTIRE shop — don't. */
const ID_NAMESPACE = "mallet:app-review-org:v1";

/** Tables whose per-org row counts are snapshotted for the isolation proof. */
const TOUCHED_TABLES = [
  "users", "org_settings", "leads", "lead_sources", "labor_rates",
  "pricebook_categories", "pricebook_items", "crew_schedules",
  "estimates", "estimate_lines", "jobs", "job_visits", "job_lines",
  "invoices", "invoice_lines", "number_sequences",
];

// ---------------------------------------------------------------------------
// Deterministic ids
// ---------------------------------------------------------------------------

/**
 * A stable UUID (v5 shape) for a fixture slug. Same slug, same id, forever — which is what
 * lets every write below be an upsert on the primary key and makes the script idempotent
 * without needing a unique index on every natural key.
 */
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

// ---------------------------------------------------------------------------
// Environment
// ---------------------------------------------------------------------------

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
const admin = createClient(SUPABASE_URL, SERVICE_ROLE_KEY);

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

const pbBySlug = new Map(PRICEBOOK_ITEMS.map((i) => [i.slug, i]));
const money = (cents) => `$${(cents / 100).toLocaleString("en-US", { minimumFractionDigits: 2 })}`;
const lineTotal = (l) => Math.round(Number(l.qty) * l.rateCents);

/** Resolve a fixture line (either a pricebook reference or a free-text line) to columns. */
function resolveLine(line, position) {
  if (line.item) {
    const item = pbBySlug.get(line.item);
    if (!item) throw new Error(`fixture references unknown pricebook item "${line.item}"`);
    return {
      description: line.note ? `${item.label} — ${line.note}` : item.label,
      qty: line.qty,
      rateCents: item.priceCents,
      costCents: item.costCents,
      position,
    };
  }
  return {
    description: line.description,
    qty: line.qty,
    rateCents: line.rateCents,
    costCents: line.costCents ?? 0,
    position,
  };
}

/**
 * A timestamptz `dayOffset` days from today at `hour` (decimal) in the ORG's timezone.
 * Built in SQL rather than JS on purpose: a JS Date with a hard-coded offset is wrong for
 * half the year, and "today" for a shop is a local-calendar fact, not a UTC one.
 */
const orgTimestamp = (dayOffset, hour) =>
  sql`((date_trunc('day', now() at time zone ${ORG_TIMEZONE}) + make_interval(days => ${dayOffset}, mins => ${Math.round(hour * 60)})) at time zone ${ORG_TIMEZONE})`;

/**
 * The org-local calendar date `dayOffset` days from today, as a `date`. The `::int` cast is
 * required: `date + $1` with an untyped parameter is ambiguous ("operator is not unique:
 * date + unknown") because Postgres cannot choose between date+int and date+interval.
 */
const orgDate = (dayOffset) =>
  sql`((now() at time zone ${ORG_TIMEZONE})::date + ${dayOffset}::int)`;

/** A `time` literal from a decimal hour, e.g. 8.5 -> '08:30:00'. */
function timeLiteral(hour) {
  const total = Math.round(hour * 60);
  const h = String(Math.floor(total / 60)).padStart(2, "0");
  const m = String(total % 60).padStart(2, "0");
  return `${h}:${m}:00`;
}

const daysAgo = (n) => sql`(now() - make_interval(days => ${n}))`;

/**
 * Fail fast on a fixture that the app's own read path would reject.
 *
 * This exists because of a real failure, not as ceremony. A `booking` blob with
 * `lane: "install"` and array-valued `triggers` wrote fine — the column is jsonb, so Postgres
 * accepted it — and then made `v1.settings.get` return 500 on OUTPUT validation. A settings
 * hydrator is the only writer of `store.toggles`, so a dead settings read left
 * `measurementEstimating` at its `false` placeholder and removed the Measure card and the "Scan a
 * room" row from the entire app. The seed looked like it had worked; the 4.2 defense was simply
 * gone. That blast radius is now closed at the root — the gate is a tri-state and "not loaded"
 * fails OPEN (lib/measurement-gate.ts) — but a 500 from settings.get still breaks the Settings
 * screens, so these assertions stay.
 *
 * Kept as hand-written assertions rather than an import of the zod DTO because this is a plain
 * .mjs script and the DTO is TypeScript. Mirror any change to bookingServiceDTO here.
 */
function validateFixture() {
  const problems = [];
  const LANES = ["repair", "estimate", "flat"];

  for (const s of SETTINGS.booking.services) {
    if (!LANES.includes(s.lane)) {
      problems.push(`booking service "${s.name}": lane "${s.lane}" is not one of ${LANES.join(" | ")}`);
    }
    if (typeof s.triggers !== "string") {
      problems.push(`booking service "${s.name}": triggers must be a comma-separated string, got ${typeof s.triggers}`);
    }
    if (s.price !== undefined && (typeof s.price !== "number" || s.price < 0)) {
      problems.push(`booking service "${s.name}": price must be a non-negative number of DOLLARS`);
    }
  }
  if (typeof SETTINGS.booking.notServices !== "string") problems.push("booking.notServices must be a string");
  if (typeof SETTINGS.booking.serviceFee !== "number") problems.push("booking.serviceFee must be a number (dollars)");
  if (typeof SETTINGS.booking.feeCredited !== "boolean") problems.push("booking.feeCredited must be a boolean");

  // The whole point of the org: without this the reviewer cannot reach the native scanner.
  if (SETTINGS.measurementEstimating !== true) {
    problems.push("SETTINGS.measurementEstimating must be true — it is what makes the room scan reachable");
  }
  // A demo org must never answer a real phone.
  if (SETTINGS.frontDesk !== false) problems.push("SETTINGS.frontDesk must be false on a demo org");

  const MEASURED = ["walls_sqft", "ceiling_sqft", "baseboard_lnft", "crown_lnft", "site_sqft", "site_lnft"];
  const ALLOWED_MEASURED_BY = [null, "hour", ...MEASURED, "doors_count", "windows_count"];
  for (const item of PRICEBOOK_ITEMS) {
    if (!ALLOWED_MEASURED_BY.includes(item.measuredBy)) {
      problems.push(`pricebook item "${item.label}": measuredBy "${item.measuredBy}" violates pricebook_items_measured_by_check`);
    }
  }
  if (!PRICEBOOK_ITEMS.some((i) => MEASURED.includes(i.measuredBy))) {
    problems.push("no measurement-priced service — a room scan would have nothing to price against");
  }

  // The reviewer's job. Every one of these is a documented step in the walkthrough.
  const reviewJob = JOBS[0];
  if (!reviewJob || reviewJob.assignee !== "user-owner") {
    problems.push("JOBS[0] must be assigned to user-owner — My day is assignee-scoped");
  }
  if (reviewJob?.dayOffset !== 0) problems.push("JOBS[0] must be scheduled today");
  if (reviewJob?.status !== "scheduled" && reviewJob?.status !== "in_progress") {
    problems.push("JOBS[0] must be scheduled or in_progress — myDay returns no other status, and a closed job makes the Quote tab read-only");
  }
  const ownerRow = CREW.find((c) => c.email === OWNER_EMAIL);
  if (!ownerRow?.isFieldCrew) problems.push("the owner login must be field crew or it has no My day");

  const slugs = [
    ...CREW.map((c) => c.slug), ...CUSTOMERS.map((c) => c.slug), ...JOBS.map((j) => j.slug),
    ...QUOTES.map((q) => q.slug), ...INVOICES.map((i) => i.slug),
    ...PRICEBOOK_ITEMS.map((i) => i.slug), ...PRICEBOOK_CATEGORIES.map((c) => c.slug),
  ];
  const dupes = slugs.filter((s, i) => slugs.indexOf(s) !== i);
  if (dupes.length) problems.push(`duplicate fixture slugs (ids would collide): ${[...new Set(dupes)].join(", ")}`);

  if (problems.length > 0) {
    console.error("FIXTURE INVALID — refusing to write:");
    for (const p of problems) console.error(`  ${p}`);
    process.exit(1);
  }
}

/** Per-org row counts for the isolation proof. */
async function snapshot() {
  const out = new Map();
  for (const table of TOUCHED_TABLES) {
    const rows = await sql`select org_id, count(*)::int as n from ${sql(table)} group by org_id`;
    for (const r of rows) out.set(`${table}:${r.org_id}`, r.n);
  }
  return out;
}

// ---------------------------------------------------------------------------
// Auth identities
// ---------------------------------------------------------------------------

/**
 * An auth identity that is ALREADY VERIFIED and can sign in with a password on the first
 * try. `email_confirm: true` is the whole point: the reviewer has no access to the inbox, so
 * a confirmation-link flow would be an unpassable gate and an automatic 2.1 rejection.
 * On a re-run the password is reset, so the notes never drift from reality.
 */
async function ensureAuthUser(email) {
  const { data, error } = await admin.auth.admin.listUsers({ perPage: 1000 });
  if (error) throw new Error(`listUsers failed: ${error.message}`);
  const existing = data?.users?.find((u) => u.email?.toLowerCase() === email.toLowerCase());

  if (existing) {
    const { error: updateError } = await admin.auth.admin.updateUserById(existing.id, {
      password: PASSWORD,
      email_confirm: true,
    });
    if (updateError) throw new Error(`updateUserById(${email}) failed: ${updateError.message}`);
    return { id: existing.id, created: false };
  }

  const { data: created, error: createError } = await admin.auth.admin.createUser({
    email,
    password: PASSWORD,
    email_confirm: true,
  });
  if (createError) throw new Error(`createUser(${email}) failed: ${createError.message}`);
  return { id: created.user.id, created: true };
}

// ---------------------------------------------------------------------------
// Writers — one per aggregate, each org-scoped
// ---------------------------------------------------------------------------

async function writeOrg() {
  await sql`
    insert into orgs (id, name) values (${ORG_ID}, ${ORG_NAME})
    on conflict (id) do update set name = excluded.name`;
}

async function writeSettings() {
  const h = SETTINGS.hours;
  await sql`
    insert into org_settings (
      id, org_id, trade, markup_bps, timezone, measurement_estimating, tech_sees_price,
      tech_texts, front_desk, scope_on, auto_remind, area_cities, area_radius_mi,
      service_origin_address, brand_tagline, brand_color, brand_initials, brand_site,
      hours_mon_open, hours_mon_close, hours_tue_open, hours_tue_close,
      hours_wed_open, hours_wed_close, hours_thu_open, hours_thu_close,
      hours_fri_open, hours_fri_close, hours_sat_open, hours_sat_close,
      hours_sun_open, hours_sun_close, booking, updated_at
    ) values (
      ${idOf("org-settings")}, ${ORG_ID}, ${SETTINGS.trade}, ${SETTINGS.markupBps}, ${SETTINGS.timezone},
      ${SETTINGS.measurementEstimating}, ${SETTINGS.techSeesPrice}, ${SETTINGS.techTexts},
      ${SETTINGS.frontDesk}, ${SETTINGS.scopeOn}, ${SETTINGS.autoRemind},
      ${SETTINGS.areaCities}, ${SETTINGS.areaRadiusMi}, ${SETTINGS.serviceOriginAddress},
      ${SETTINGS.brand.tagline}, ${SETTINGS.brand.color}, ${SETTINGS.brand.initials}, ${SETTINGS.brand.site},
      ${h.mon[0]}, ${h.mon[1]}, ${h.tue[0]}, ${h.tue[1]}, ${h.wed[0]}, ${h.wed[1]},
      ${h.thu[0]}, ${h.thu[1]}, ${h.fri[0]}, ${h.fri[1]}, ${h.sat[0]}, ${h.sat[1]},
      ${h.sun[0]}, ${h.sun[1]}, ${JSON.stringify(SETTINGS.booking)}::jsonb, now()
    )
    on conflict (id) do update set
      trade = excluded.trade, markup_bps = excluded.markup_bps, timezone = excluded.timezone,
      measurement_estimating = excluded.measurement_estimating,
      tech_sees_price = excluded.tech_sees_price, tech_texts = excluded.tech_texts,
      front_desk = excluded.front_desk, scope_on = excluded.scope_on,
      auto_remind = excluded.auto_remind, area_cities = excluded.area_cities,
      area_radius_mi = excluded.area_radius_mi,
      service_origin_address = excluded.service_origin_address,
      brand_tagline = excluded.brand_tagline, brand_color = excluded.brand_color,
      brand_initials = excluded.brand_initials, brand_site = excluded.brand_site,
      hours_mon_open = excluded.hours_mon_open, hours_mon_close = excluded.hours_mon_close,
      hours_tue_open = excluded.hours_tue_open, hours_tue_close = excluded.hours_tue_close,
      hours_wed_open = excluded.hours_wed_open, hours_wed_close = excluded.hours_wed_close,
      hours_thu_open = excluded.hours_thu_open, hours_thu_close = excluded.hours_thu_close,
      hours_fri_open = excluded.hours_fri_open, hours_fri_close = excluded.hours_fri_close,
      hours_sat_open = excluded.hours_sat_open, hours_sat_close = excluded.hours_sat_close,
      hours_sun_open = excluded.hours_sun_open, hours_sun_close = excluded.hours_sun_close,
      booking = excluded.booking, updated_at = now()`;
}

async function writeCrew(authIds) {
  for (const member of CREW) {
    await sql`
      insert into users (id, org_id, auth_user_id, email, name, role, is_field_crew, skill_tags, updated_at)
      values (${idOf(member.slug)}, ${ORG_ID}, ${authIds.get(member.email)}, ${member.email},
              ${member.name}, ${member.role}, ${member.isFieldCrew}, ${member.skillTags ?? []}, now())
      on conflict (id) do update set
        auth_user_id = excluded.auth_user_id, email = excluded.email, name = excluded.name,
        role = excluded.role, is_field_crew = excluded.is_field_crew,
        skill_tags = excluded.skill_tags, updated_at = now()`;
  }

  // Mon–Fri working hours per crew member, so the Schedule board offers real slots instead
  // of falling back to the org default for every day. weekday follows JS getDay().
  for (const member of CREW) {
    for (const weekday of [1, 2, 3, 4, 5]) {
      const [open, close] = weekday === 5 ? SETTINGS.hours.fri : SETTINGS.hours.mon;
      await sql`
        insert into crew_schedules (org_id, user_id, weekday, open_hour, close_hour)
        values (${ORG_ID}, ${idOf(member.slug)}, ${weekday}, ${open}, ${close})
        on conflict (org_id, user_id, weekday) do update set
          open_hour = excluded.open_hour, close_hour = excluded.close_hour`;
    }
  }
}

async function writeLibraries() {
  for (const [position, label] of LEAD_SOURCES.entries()) {
    await sql`
      insert into lead_sources (id, org_id, label, position, updated_at)
      values (${idOf(`source-${label}`)}, ${ORG_ID}, ${label}, ${position}, now())
      on conflict (id) do update set label = excluded.label, position = excluded.position, updated_at = now()`;
  }
  for (const [position, rate] of LABOR_RATES.entries()) {
    await sql`
      insert into labor_rates (id, org_id, label, rate_cents_per_hour, kind, position, updated_at)
      values (${idOf(rate.slug)}, ${ORG_ID}, ${rate.label}, ${rate.centsPerHour}, ${rate.kind}, ${position}, now())
      on conflict (id) do update set
        label = excluded.label, rate_cents_per_hour = excluded.rate_cents_per_hour,
        kind = excluded.kind, position = excluded.position, updated_at = now()`;
  }
}

async function writePricebook() {
  for (const cat of PRICEBOOK_CATEGORIES) {
    await sql`
      insert into pricebook_categories (id, org_id, name, sort_order, updated_at)
      values (${idOf(cat.slug)}, ${ORG_ID}, ${cat.name}, ${cat.sortOrder}, now())
      on conflict (id) do update set
        name = excluded.name, sort_order = excluded.sort_order, updated_at = now()`;
  }
  for (const [position, item] of PRICEBOOK_ITEMS.entries()) {
    await sql`
      insert into pricebook_items (
        id, org_id, category_id, code, label, description, unit_price_cents, cost_cents,
        labor_hours, measured_by, warranty_text, taxable, active, position, updated_at
      ) values (
        ${idOf(item.slug)}, ${ORG_ID}, ${idOf(item.cat)}, ${item.code}, ${item.label},
        ${item.description ?? null}, ${item.priceCents}, ${item.costCents},
        ${item.laborHours ?? null}, ${item.measuredBy}, ${item.warranty ?? null},
        false, true, ${position}, now()
      )
      on conflict (id) do update set
        category_id = excluded.category_id, code = excluded.code, label = excluded.label,
        description = excluded.description, unit_price_cents = excluded.unit_price_cents,
        cost_cents = excluded.cost_cents, labor_hours = excluded.labor_hours,
        measured_by = excluded.measured_by, warranty_text = excluded.warranty_text,
        active = excluded.active, position = excluded.position, updated_at = now()`;
  }
}

async function writeCustomers() {
  for (const c of CUSTOMERS) {
    await sql`
      insert into leads (
        id, org_id, name, phone_e164, email, address, stage, source, value_cents,
        notes, role, loss_reason, won_at, updated_at
      ) values (
        ${idOf(c.slug)}, ${ORG_ID}, ${c.name}, ${c.phone}, ${c.email}, ${c.address},
        ${c.stage}, ${c.source}, ${c.valueCents}, ${c.notes ?? null}, ${c.role ?? null},
        ${c.lossReason ?? null},
        ${c.stage === "won" ? daysAgo(9) : null},
        now()
      )
      on conflict (id) do update set
        name = excluded.name, phone_e164 = excluded.phone_e164, email = excluded.email,
        address = excluded.address, stage = excluded.stage, source = excluded.source,
        value_cents = excluded.value_cents, notes = excluded.notes, role = excluded.role,
        loss_reason = excluded.loss_reason, won_at = excluded.won_at, updated_at = now()`;
  }
}

async function writeQuotes() {
  for (const q of QUOTES) {
    // A stable public token: the /q/<token> customer view must survive a re-seed, or a
    // link already shown in a screen recording stops resolving.
    const token = createHash("sha256").update(`${ID_NAMESPACE}:token:${q.slug}`).digest("hex");
    await sql`
      insert into estimates (
        id, org_id, num, lead_id, title, status, tax_bps, valid_days,
        sent_at, accepted_at, public_token, origin, created_at, updated_at
      ) values (
        ${idOf(q.slug)}, ${ORG_ID}, ${q.num}, ${idOf(q.customer)}, ${q.title}, ${q.status},
        ${q.taxBps}, ${q.validDays},
        ${q.sentDaysAgo ? daysAgo(q.sentDaysAgo) : null},
        ${q.acceptedDaysAgo ? daysAgo(q.acceptedDaysAgo) : null},
        ${token}, 'office', ${daysAgo((q.sentDaysAgo ?? 2) + 1)}, now()
      )
      on conflict (id) do update set
        num = excluded.num, lead_id = excluded.lead_id, title = excluded.title,
        status = excluded.status, tax_bps = excluded.tax_bps, valid_days = excluded.valid_days,
        sent_at = excluded.sent_at, accepted_at = excluded.accepted_at, updated_at = now()`;

    // Lines are replaced wholesale under this estimate — an edited fixture must not leave
    // the previous run's lines behind, doubling the quote.
    await sql`delete from estimate_lines where org_id = ${ORG_ID} and estimate_id = ${idOf(q.slug)}`;
    for (const [i, raw] of q.lines.entries()) {
      const l = resolveLine(raw, i + 1);
      await sql`
        insert into estimate_lines (id, org_id, estimate_id, description, quantity, rate_cents, cost_cents, position, updated_at)
        values (${idOf(`${q.slug}-line-${i}`)}, ${ORG_ID}, ${idOf(q.slug)}, ${l.description},
                ${l.qty}, ${l.rateCents}, ${l.costCents}, ${l.position}, now())`;
    }
  }
}

async function writeJobs() {
  for (const job of JOBS) {
    const lines = job.lines.map((raw, i) => resolveLine(raw, i + 1));
    const totalCents = lines.reduce((sum, l) => sum + lineTotal(l), 0);
    const scheduled = job.dayOffset !== null && job.startHour !== null;
    const start = scheduled ? orgTimestamp(job.dayOffset, job.startHour) : null;
    const end = scheduled ? orgTimestamp(job.dayOffset, job.startHour + job.durationMinutes / 60) : null;
    const started = job.status === "in_progress" || job.status === "complete" ? start : null;
    const completed = job.status === "complete" ? end : null;

    await sql`
      insert into jobs (
        id, org_id, num, lead_id, source_estimate_id, assignee_user_id, title, svc, kind,
        status, scheduled_start, scheduled_end, started_at, completed_at, total_cents,
        notes, scope, addr, completion, created_at, updated_at
      ) values (
        ${idOf(job.slug)}, ${ORG_ID}, ${job.num}, ${idOf(job.customer)},
        ${job.fromQuote ? idOf(job.fromQuote) : null},
        ${job.assignee ? idOf(job.assignee) : null},
        ${job.title}, ${job.svc}, ${job.kind}, ${job.status},
        ${start}, ${end}, ${started}, ${completed}, ${totalCents},
        ${job.notes ?? null}, ${job.scope ?? null}, ${job.addr}, ${job.completion ?? null},
        ${daysAgo(Math.abs(job.dayOffset ?? 2) + 4)}, now()
      )
      on conflict (id) do update set
        num = excluded.num, lead_id = excluded.lead_id,
        source_estimate_id = excluded.source_estimate_id,
        assignee_user_id = excluded.assignee_user_id, title = excluded.title,
        svc = excluded.svc, kind = excluded.kind, status = excluded.status,
        scheduled_start = excluded.scheduled_start, scheduled_end = excluded.scheduled_end,
        started_at = excluded.started_at, completed_at = excluded.completed_at,
        total_cents = excluded.total_cents, notes = excluded.notes, scope = excluded.scope,
        addr = excluded.addr, completion = excluded.completion, updated_at = now()`;

    await sql`delete from job_lines where org_id = ${ORG_ID} and job_id = ${idOf(job.slug)}`;
    for (const [i, l] of lines.entries()) {
      await sql`
        insert into job_lines (id, org_id, job_id, description, quantity, rate_cents, cost_cents, position, updated_at)
        values (${idOf(`${job.slug}-line-${i}`)}, ${ORG_ID}, ${idOf(job.slug)}, ${l.description},
                ${l.qty}, ${l.rateCents}, ${l.costCents}, ${l.position}, now())`;
    }

    // ONE visit per job. The visit — not the job header — is what the Schedule board places
    // and what My day's assignee-scoped query matches on, so an unassigned or undated visit
    // is how a job lands in the board's unplaced column.
    const visitStatus =
      job.status === "complete" ? "complete" : job.status === "in_progress" ? "in_progress" : "pending";
    await sql`
      insert into job_visits (
        id, org_id, job_id, assignee_user_id, scheduled_date, scheduled_start, scheduled_end,
        duration_minutes, status, started_at, completed_at, notes, position, updated_at
      ) values (
        ${idOf(`${job.slug}-visit`)}, ${ORG_ID}, ${idOf(job.slug)},
        ${job.assignee ? idOf(job.assignee) : null},
        ${scheduled ? orgDate(job.dayOffset) : null},
        ${scheduled ? timeLiteral(job.startHour) : null},
        ${scheduled ? timeLiteral(job.startHour + job.durationMinutes / 60) : null},
        ${job.durationMinutes}, ${visitStatus}, ${started}, ${completed},
        ${job.scope ?? null}, 0, now()
      )
      on conflict (id) do update set
        assignee_user_id = excluded.assignee_user_id, scheduled_date = excluded.scheduled_date,
        scheduled_start = excluded.scheduled_start, scheduled_end = excluded.scheduled_end,
        duration_minutes = excluded.duration_minutes, status = excluded.status,
        started_at = excluded.started_at, completed_at = excluded.completed_at,
        notes = excluded.notes, updated_at = now()`;
  }
}

async function writeInvoices() {
  for (const inv of INVOICES) {
    const job = JOBS.find((j) => j.slug === inv.job);
    if (!job) throw new Error(`invoice ${inv.num} references unknown job "${inv.job}"`);
    const lines = job.lines.map((raw, i) => resolveLine(raw, i + 1));
    const totalCents = lines.reduce((sum, l) => sum + lineTotal(l), 0);
    const paidCents = inv.paidInFull ? totalCents : 0;

    await sql`
      insert into invoices (
        id, org_id, num, source_job_id, lead_id, title, status, total_cents,
        amount_paid_cents, terms_days, tax_bps, tax_cents, sent_at, due_at,
        created_at, updated_at
      ) values (
        ${idOf(inv.slug)}, ${ORG_ID}, ${inv.num}, ${idOf(job.slug)}, ${idOf(job.customer)},
        ${job.title}, ${inv.status}, ${totalCents}, ${paidCents}, ${inv.termsDays}, 0, 0,
        ${daysAgo(inv.sentDaysAgo)},
        ${sql`(now() - make_interval(days => ${inv.sentDaysAgo}) + make_interval(days => ${inv.termsDays}))`},
        ${daysAgo(inv.sentDaysAgo)}, now()
      )
      on conflict (id) do update set
        num = excluded.num, source_job_id = excluded.source_job_id, lead_id = excluded.lead_id,
        title = excluded.title, status = excluded.status, total_cents = excluded.total_cents,
        amount_paid_cents = excluded.amount_paid_cents, terms_days = excluded.terms_days,
        sent_at = excluded.sent_at, due_at = excluded.due_at, updated_at = now()`;

    await sql`delete from invoice_lines where org_id = ${ORG_ID} and invoice_id = ${idOf(inv.slug)}`;
    for (const [i, l] of lines.entries()) {
      await sql`
        insert into invoice_lines (id, org_id, invoice_id, description, quantity, rate_cents, cost_cents, position, updated_at)
        values (${idOf(`${inv.slug}-line-${i}`)}, ${ORG_ID}, ${idOf(inv.slug)}, ${l.description},
                ${l.qty}, ${l.rateCents}, ${l.costCents}, ${l.position}, now())`;
    }
  }
}

async function writeSequences() {
  // Start the org's own counters above every hand-written num, so the first record a
  // reviewer creates gets a fresh number instead of colliding with a seeded one. GREATEST
  // keeps a re-run from rewinding a counter the reviewer has already advanced.
  for (const kind of ["job", "estimate", "invoice"]) {
    await sql`
      insert into number_sequences (org_id, kind, next_val, updated_at)
      values (${ORG_ID}, ${kind}, ${SEQUENCE_START}, now())
      on conflict (org_id, kind) do update set
        next_val = greatest(number_sequences.next_val, ${SEQUENCE_START}), updated_at = now()`;
  }
}

// ---------------------------------------------------------------------------
// Report
// ---------------------------------------------------------------------------

async function report(before, after) {
  const leaked = [];
  for (const key of new Set([...before.keys(), ...after.keys()])) {
    const [table, orgId] = key.split(":");
    if (orgId === ORG_ID) continue;
    if ((before.get(key) ?? 0) !== (after.get(key) ?? 0)) {
      leaked.push(`${table} / org ${orgId}: ${before.get(key) ?? 0} -> ${after.get(key) ?? 0}`);
    }
  }

  const [counts] = await sql`
    select
      (select count(*)::int from users     where org_id = ${ORG_ID}) crew,
      (select count(*)::int from leads     where org_id = ${ORG_ID} and deleted_at is null) customers,
      (select count(*)::int from jobs      where org_id = ${ORG_ID} and deleted_at is null) jobs,
      (select count(*)::int from job_visits where org_id = ${ORG_ID} and deleted_at is null) visits,
      (select count(*)::int from estimates where org_id = ${ORG_ID} and deleted_at is null) quotes,
      (select count(*)::int from invoices  where org_id = ${ORG_ID} and deleted_at is null) invoices,
      (select count(*)::int from pricebook_items where org_id = ${ORG_ID} and deleted_at is null) services,
      (select count(*)::int from pricebook_items where org_id = ${ORG_ID} and measured_by in ('walls_sqft','ceiling_sqft','baseboard_lnft','crown_lnft','site_sqft','site_lnft')) measured_services,
      (select measurement_estimating from org_settings where org_id = ${ORG_ID}) measurement_estimating,
      (select front_desk from org_settings where org_id = ${ORG_ID}) front_desk,
      (select coalesce(sum(total_cents),0)::int from invoices where org_id = ${ORG_ID} and status = 'paid') collected_cents`;

  const todays = await sql`
    select j.num, j.title, j.status, j.kind, u.name as crew,
           to_char(v.scheduled_start, 'HH24:MI') as at
    from jobs j
    join job_visits v on v.job_id = j.id and v.org_id = j.org_id and v.deleted_at is null
    left join users u on u.id = v.assignee_user_id
    where j.org_id = ${ORG_ID}
      and v.scheduled_date = (now() at time zone ${ORG_TIMEZONE})::date
    order by v.scheduled_start`;

  console.log("");
  console.log(`  org               ${ORG_NAME}`);
  console.log(`  org id            ${ORG_ID}`);
  console.log(`  login             ${OWNER_EMAIL}  /  ${PASSWORD}`);
  console.log("");
  console.log(`  crew              ${counts.crew}`);
  console.log(`  customers         ${counts.customers}`);
  console.log(`  jobs / visits     ${counts.jobs} / ${counts.visits}`);
  console.log(`  quotes            ${counts.quotes}`);
  console.log(`  invoices          ${counts.invoices}  (${money(counts.collected_cents)} collected)`);
  console.log(`  services          ${counts.services}  (${counts.measured_services} measurement-priced)`);
  console.log("");
  console.log(`  measurementEstimating   ${counts.measurement_estimating}   <- gates the "Scan a room" row`);
  console.log(`  frontDesk               ${counts.front_desk}   <- must stay false (no phone number)`);
  console.log("");
  console.log("  today's board:");
  for (const r of todays) {
    console.log(`    ${r.at}  ${r.num}  ${r.title} — ${r.crew ?? "unassigned"} (${r.status})`);
  }
  console.log("");

  if (leaked.length > 0) {
    console.error("  ISOLATION CHECK FAILED — rows changed outside this org:");
    for (const l of leaked) console.error(`    ${l}`);
    process.exitCode = 1;
    return;
  }
  console.log(`  isolation check   PASS — no rows written outside ${ORG_ID}`);
}

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------

try {
  validateFixture();

  const guard = await sql`select id, name from orgs where id = ${ORG_ID} or name = ${ORG_NAME}`;
  const conflicting = guard.find((o) => o.id !== ORG_ID);
  if (conflicting) {
    // An org with our NAME but a different id means someone made this shop by hand. Writing
    // into it blind would be exactly the "don't touch orgs you didn't create" mistake.
    console.error(`REFUSING: an org named "${ORG_NAME}" already exists with id ${conflicting.id},`);
    console.error(`which is not this script's deterministic id (${ORG_ID}). Resolve by hand.`);
    process.exit(1);
  }

  if (DRY) {
    console.log(`--dry-run: would ${guard.length ? "UPDATE" : "CREATE"} org ${ORG_NAME} (${ORG_ID})`);
    console.log(`  login    ${OWNER_EMAIL} / ${PASSWORD}`);
    console.log(`  content  ${CREW.length} crew · ${CUSTOMERS.length} customers · ${JOBS.length} jobs · ${QUOTES.length} quotes · ${INVOICES.length} invoices · ${PRICEBOOK_ITEMS.length} services`);
    console.log("  nothing written.");
    process.exit(0);
  }

  const before = await snapshot();

  const authIds = new Map();
  for (const member of CREW) {
    const { id, created } = await ensureAuthUser(member.email);
    authIds.set(member.email, id);
    console.log(`  auth ${created ? "created" : "updated"}  ${member.email}`);
  }

  await writeOrg();
  await writeSettings();
  await writeCrew(authIds);
  await writeLibraries();
  await writePricebook();
  await writeCustomers();
  await writeQuotes();
  await writeJobs();
  await writeInvoices();
  await writeSequences();

  const after = await snapshot();
  await report(before, after);
} catch (err) {
  console.error("failed:", err.message);
  process.exitCode = 1;
} finally {
  await sql.end({ timeout: 10 });
}
