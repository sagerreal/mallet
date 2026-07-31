/**
 * scripts/scale-benchmark.mjs
 *
 * The plan's last success criterion: "Board and lists stay responsive with 40,000 jobs — seed to
 * that number and measure."
 *
 * Seeds a THROWAWAY org to that scale, runs EXPLAIN ANALYZE on the exact query shapes the
 * repositories emit, prints what the planner actually chose, and deletes the org again.
 *
 *   node --env-file=.env.local scripts/scale-benchmark.mjs
 *   node --env-file=.env.local scripts/scale-benchmark.mjs --jobs 40000 --keep
 *
 * WHY A SEPARATE ORG AND NOT THE REAL ONE. Everything here is bulk-inserted with the owner
 * credential, and a benchmark that leaves 40,000 rows in a live shop's book is worse than no
 * benchmark. The org is dropped in a finally block; orgs cascade, so the delete takes the jobs,
 * visits, invoices and entries with it. --keep exists for digging into a bad plan afterwards and
 * prints the id to clean up by hand.
 *
 * WHY EXPLAIN AND NOT A STOPWATCH. A wall-clock number off one laptop over a WAN says more about
 * the network than the query. What matters is whether the planner picked an index scan or fell
 * back to a sequential scan over the whole tenant — that is the difference that turns into a
 * timeout as a shop grows, and it is visible in the plan regardless of where the script runs.
 */

import postgres from "postgres";

const arg = (name, fallback) => {
  const i = process.argv.indexOf(`--${name}`);
  return i >= 0 && process.argv[i + 1] ? Number(process.argv[i + 1]) : fallback;
};
const has = (name) => process.argv.includes(`--${name}`);

const JOBS = arg("jobs", 40_000);
const CUSTOMERS = arg("customers", 8_000);
const INVOICES = arg("invoices", 12_000);
const ENTRIES = arg("entries", 20_000);
const KEEP = has("keep");

const url = process.env.DATABASE_URL;
if (!url) {
  console.error("DATABASE_URL is required (run with --env-file=.env.local)");
  process.exit(1);
}

const sql = postgres(url, { max: 1, ssl: "require", prepare: false, idle_timeout: 20 });

/** Pull the interesting lines out of a plan: what was scanned, how, and how long it took. */
const summarise = (rows) => {
  const lines = rows.map((r) => r["QUERY PLAN"]);
  const scans = lines.filter((l) => /Scan/.test(l)).map((l) => l.trim().replace(/\s+\(cost.*/, ""));
  const time = lines.find((l) => /Execution Time/.test(l))?.trim() ?? "";
  const seq = scans.some((s) => /^->\s*Seq Scan|^Seq Scan/.test(s));
  return { scans, time, seq };
};

const measure = async (label, query) => {
  const { scans, time, seq } = summarise(await sql.unsafe(`explain (analyze) ${query}`));
  const ms = Number(time.replace(/[^\d.]/g, ""));
  const verdict = seq ? "SEQ SCAN" : "index";
  console.log(`\n${seq ? "✗" : "✓"} ${label}  —  ${ms.toFixed(1)} ms  (${verdict})`);
  for (const s of scans.slice(0, 3)) console.log(`     ${s}`);
  return { label, ms, seq };
};

let orgId = "";
const results = [];

try {
  const [org] = await sql`
    insert into orgs (name) values ('SCALE BENCH ' || gen_random_uuid()) returning id`;
  orgId = org.id;
  console.log(`org ${orgId}\nseeding ${CUSTOMERS} customers, ${JOBS} jobs, ${INVOICES} invoices, ${ENTRIES} time entries…`);

  const [user] = await sql`
    insert into users (org_id, auth_user_id, name, email, role)
    values (${orgId}, gen_random_uuid(), 'Bench Tech', gen_random_uuid() || '@bench.test', 'tech')
    returning id`;

  // set-based inserts: 40,000 round trips would take longer than the measurement is worth.
  await sql`
    insert into leads (org_id, name, phone_e164, email, stage, created_at, updated_at)
    select ${orgId},
           'Cust ' || to_char(g, 'FM00000'),
           '+1555' || lpad((g % 10000)::text, 7, '0'),
           'cust' || g || '@bench.test',
           (array['new','contacted','quote_sent','won','lost'])[1 + (g % 5)],
           now() - (g || ' hours')::interval,
           now() - (g || ' hours')::interval
    from generate_series(1, ${CUSTOMERS}) g`;

  await sql`
    insert into jobs (org_id, lead_id, num, title, status, total_cents, scheduled_start, created_at)
    select ${orgId},
           l.id,
           'BJ-' || g,
           (array['Water heater','Drain clearing','Repipe','Leak repair','Fixture swap'])[1 + (g % 5)],
           (array['scheduled','complete','canceled'])[1 + (g % 3)],
           (10000 + (g % 500) * 100),
           case when g % 7 = 0 then null
                else now() - ((g % 400) || ' days')::interval end,
           now() - (g || ' minutes')::interval
    from generate_series(1, ${JOBS}) g
    join lateral (
      select id from leads where org_id = ${orgId} offset (g % ${CUSTOMERS}) limit 1
    ) l on true`;

  await sql`
    insert into job_visits (org_id, job_id, scheduled_date, duration_minutes, status, assignee_user_id)
    select ${orgId}, j.id,
           (current_date - (((row_number() over ()) % 400))::int),
           120, 'pending', ${user.id}
    from jobs j where j.org_id = ${orgId}`;

  await sql`
    insert into invoices (org_id, lead_id, num, status, total_cents, amount_paid_cents, due_at, created_at)
    select ${orgId}, l.id, 'BI-' || g,
           (array['draft','sent','partial','paid'])[1 + (g % 4)],
           25000, case when g % 4 = 2 then 10000 when g % 4 = 3 then 25000 else 0 end,
           now() - ((g % 200) || ' days')::interval,
           now() - (g || ' minutes')::interval
    from generate_series(1, ${INVOICES}) g
    join lateral (
      select id from leads where org_id = ${orgId} offset (g % ${CUSTOMERS}) limit 1
    ) l on true`;

  await sql`
    insert into time_entries (org_id, tech_user_id, work_date, kind, start_time, end_time, src, status, running)
    select ${orgId}, ${user.id},
           (current_date - (g % 365)::int),
           'job', '08:00', '16:00', 'clock', 'draft', false
    from generate_series(1, ${ENTRIES}) g`;

  // A NEEDLE. The generated titles repeat five values, so searching one of them matches a fifth
  // of the table — and for 20% selectivity a sequential scan is genuinely the right plan, which
  // makes it a useless test of the index. Real searches are selective: a name, a job number, a
  // street. These two rows are what a real search looks for.
  await sql`
    insert into jobs (org_id, lead_id, num, title, status, total_cents, created_at)
    select ${orgId}, l.id, 'BJ-NEEDLE', 'Backflow preventer certification', 'scheduled', 99900, now()
    from leads l where l.org_id = ${orgId} limit 1`;
  await sql`
    insert into leads (org_id, name, phone_e164, email, stage, created_at, updated_at)
    values (${orgId}, 'Zsofia Quennell', '+15550009999', 'zq@bench.test', 'new', now(), now())`;

  await sql`analyze leads`;
  await sql`analyze jobs`;
  await sql`analyze job_visits`;
  await sql`analyze invoices`;
  await sql`analyze time_entries`;

  const [{ n: jobCount }] = await sql`select count(*)::int n from jobs where org_id = ${orgId}`;
  console.log(`\nseeded. ${jobCount} jobs.\n${"─".repeat(72)}`);

  const O = `'${orgId}'`;

  // ---- the shapes the repositories actually emit --------------------------------------------
  results.push(await measure("jobs · default sort (scheduled desc, nulls last)",
    `select * from jobs where org_id = ${O} and deleted_at is null
     order by scheduled_start desc nulls last, id desc limit 50`));

  results.push(await measure("jobs · sort by created",
    `select * from jobs where org_id = ${O} and deleted_at is null
     order by created_at desc nulls last, id desc limit 50`));

  results.push(await measure("jobs · sort by amount",
    `select * from jobs where org_id = ${O} and deleted_at is null
     order by total_cents desc nulls last, id desc limit 50`));

  results.push(await measure("jobs · sort by CUSTOMER (join leads)",
    `select j.* from jobs j join leads l on l.org_id = j.org_id and l.id = j.lead_id
     where j.org_id = ${O} and j.deleted_at is null
     order by l.name asc nulls last, j.id asc limit 50`));

  results.push(await measure("jobs · search title/number (selective, trigram)",
    `select * from jobs where org_id = ${O} and deleted_at is null
       and (title ilike '%backflow%' or num ilike '%backflow%')
     order by created_at desc, id desc limit 50`));

  // The other half of the picture: a term that matches a large slice. A sequential scan here is
  // CORRECT — 20% selectivity is cheaper to scan than to hop through an index — so this is
  // measured to know the cost, not flagged as a fault.
  results.push(await measure("jobs · search matching 20% of the table (scan is correct)",
    `select * from jobs where org_id = ${O} and deleted_at is null
       and (title ilike '%repipe%' or num ilike '%repipe%')
     order by created_at desc, id desc limit 50`));

  results.push(await measure("jobs · count for the header",
    `select count(*)::int from jobs where org_id = ${O} and deleted_at is null`));

  results.push(await measure("board · one week of visits (visitFrom/visitTo)",
    `select j.* from jobs j where j.org_id = ${O} and j.deleted_at is null
       and exists (select 1 from job_visits v where v.org_id = j.org_id and v.job_id = j.id
                     and v.status <> 'canceled' and v.deleted_at is null
                     and v.scheduled_date between current_date - 3 and current_date + 3)
     order by j.created_at desc, j.id desc limit 400`));

  results.push(await measure("customers · default sort (last activity)",
    `select * from leads where org_id = ${O} and deleted_at is null
     order by updated_at desc nulls last, id desc limit 50`));

  results.push(await measure("customers · search name (selective, trigram)",
    `select * from leads where org_id = ${O} and deleted_at is null and name ilike '%quennell%'
     order by created_at desc, id desc limit 50`));

  results.push(await measure("customers · worklist: owes money",
    `select l.* from leads l where l.org_id = ${O} and l.deleted_at is null
       and exists (select 1 from invoices i where i.org_id = l.org_id and i.lead_id = l.id
                     and i.deleted_at is null and i.status <> 'draft'
                     and greatest(0, i.total_cents - i.deposit_paid_cents - i.amount_paid_cents) > 0)
     order by l.created_at desc, l.id desc limit 50`));

  results.push(await measure("invoices · ledger order (CASE rank)",
    `select * from invoices where org_id = ${O} and deleted_at is null
     order by (case when status = 'draft' then 1
                    when status <> 'draft' and greatest(0, total_cents - deposit_paid_cents - amount_paid_cents) > 0
                         and due_at is not null and due_at < now() then 2
                    when status <> 'draft' and greatest(0, total_cents - deposit_paid_cents - amount_paid_cents) > 0
                         and amount_paid_cents > 0 then 3
                    when status <> 'draft' and greatest(0, total_cents - deposit_paid_cents - amount_paid_cents) > 0 then 4
                    else 5 end) asc nulls last, id asc limit 50`));

  results.push(await measure("invoices · collection order (oldest unpaid)",
    `select * from invoices where org_id = ${O} and deleted_at is null
     order by due_at asc nulls last, id asc limit 50`));

  results.push(await measure("timesheets · one week (fromDate/toDate)",
    `select * from time_entries where org_id = ${O} and deleted_at is null
       and work_date >= current_date - 7 and work_date <= current_date
     order by work_date asc nulls last, id asc limit 500`));

  console.log(`\n${"─".repeat(72)}`);
  const slow = results.filter((r) => r.ms > 200);
  const seqs = results.filter((r) => r.seq);
  const worst = [...results].sort((a, b) => b.ms - a.ms)[0];
  console.log(`${results.length} queries at ${jobCount} jobs · slowest ${worst.ms.toFixed(1)} ms (${worst.label})`);
  console.log(seqs.length ? `SEQUENTIAL SCANS: ${seqs.map((s) => s.label).join(", ")}` : "no sequential scans");
  console.log(slow.length ? `OVER 200ms: ${slow.map((s) => s.label).join(", ")}` : "nothing over 200 ms");
} finally {
  if (orgId && !KEEP) {
    // Child-first. Deleting the org alone fails: job_visits.assignee_user_id references users
    // WITHOUT a cascade, so the org's users cannot go while visits still point at them — and a
    // half-deleted benchmark org is worse than none, because the next run's numbers include it.
    await sql`set statement_timeout = '600s'`;
    await sql`delete from job_visits where org_id = ${orgId}`;
    await sql`delete from time_entries where org_id = ${orgId}`;
    await sql`delete from invoices where org_id = ${orgId}`;
    // BATCHED. jobs.callback_of is a self-referencing FK with no index behind it, so deleting a
    // job re-checks the whole jobs table for children. One DELETE of 40,000 rows blows the
    // statement timeout and leaves the benchmark org half-removed — which then silently inflates
    // the next run's numbers. Small statements finish; the loop does the work.
    for (;;) {
      const r = await sql`delete from jobs where id in (select id from jobs where org_id = ${orgId} limit 2000)`;
      if (r.count === 0) break;
    }
    await sql`delete from leads where org_id = ${orgId}`;
    await sql`delete from users where org_id = ${orgId}`;
    await sql`delete from orgs where id = ${orgId}`;
    const [{ n }] = await sql`select count(*)::int n from jobs where org_id = ${orgId}`;
    console.log(`\ncleaned up org ${orgId} (${n} jobs remain — must be 0)`);
  } else if (orgId) {
    console.log(`\n--keep: org ${orgId} left in place. Remove with:  delete from orgs where id = '${orgId}';`);
  }
  await sql.end({ timeout: 10 });
}
