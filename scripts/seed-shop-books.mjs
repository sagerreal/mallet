/**
 * scripts/seed-shop-books.mjs
 *
 * Gives the demo org the BOOKS a real shop would have. The work was already there — 1,524 jobs
 * spread across past, today and future — but the paperwork was not:
 *
 *   843 invoices, every one a $0 draft with no lines
 *   1,518 of 1,524 jobs priced at $0, despite having job lines with real rates
 *   28 quotes for 607 customers, so the Pipeline board had nothing to show
 *
 * That is why Money read "3", the Dashboard read $0, and the Pipeline looked empty. None of it was
 * a display bug; there was simply nothing to display.
 *
 *   node --env-file=.env.local scripts/seed-shop-books.mjs            # the demo org
 *   node --env-file=.env.local scripts/seed-shop-books.mjs --org <id>
 *   node --env-file=.env.local scripts/seed-shop-books.mjs --dry-run
 *
 * WRITES TO THE SHARED DATABASE, and only ever to ONE org — the id is required in the query of
 * every statement below, never left to a WHERE that could match another shop's rows.
 *
 * IDEMPOTENT. Re-running recomputes the same totals and skips invoices that already have lines,
 * so it can be run again after more seeding without doubling anything.
 *
 * The distribution is chosen to look like a plumbing shop's ledger rather than to be uniform:
 * most finished work is paid, a slice is still out, a smaller slice is late, a few are part-paid,
 * and a handful of finished jobs have no invoice at all — which is the "ready to bill" worklist
 * the Money screen exists to surface.
 */

import postgres from "postgres";

const DEMO_ORG = "6d2ceccc-e7bb-4d43-904d-d23c01cf9528";
const argOf = (name, fallback) => {
  const i = process.argv.indexOf(`--${name}`);
  return i >= 0 && process.argv[i + 1] ? process.argv[i + 1] : fallback;
};
const ORG = argOf("org", DEMO_ORG);
const DRY = process.argv.includes("--dry-run");

const url = process.env.DATABASE_URL;
if (!url) {
  console.error("DATABASE_URL is required (run with --env-file=.env.local)");
  process.exit(1);
}
const sql = postgres(url, { max: 1, ssl: "require", prepare: false });

const show = async (label) => {
  const [r] = await sql`
    select
      (select count(*)::int from jobs where org_id = ${ORG} and deleted_at is null and total_cents = 0) unpriced_jobs,
      (select count(*)::int from invoices i where i.org_id = ${ORG} and i.deleted_at is null and i.total_cents = 0) zero_invoices,
      (select count(*)::int from invoices where org_id = ${ORG} and deleted_at is null and status = 'paid') paid,
      (select count(*)::int from invoices where org_id = ${ORG} and deleted_at is null and status = 'sent') sent,
      (select count(*)::int from invoices where org_id = ${ORG} and deleted_at is null and status = 'partial') partial,
      (select count(*)::int from estimates where org_id = ${ORG} and deleted_at is null) quotes`;
  console.log(`${label}:`, r);
};

try {
  await show("before");
  if (DRY) {
    console.log("\n--dry-run: nothing written.");
    process.exit(0);
  }

  await sql`set statement_timeout = '600s'`;

  // 1. PRICE THE WORK. The job lines carry real rates; the header total was never filled in, so
  //    every job read $0 — and the Dashboard's money tiles sum that column.
  const priced = await sql`
    update jobs j set total_cents = coalesce(l.sum_cents, 0)
    from (
      select jl.job_id, sum(round(jl.quantity * jl.rate_cents))::int sum_cents
      from job_lines jl
      join jobs j2 on j2.id = jl.job_id and j2.org_id = ${ORG}
      where jl.deleted_at is null
      group by jl.job_id
    ) l
    where j.id = l.job_id and j.org_id = ${ORG} and j.total_cents is distinct from l.sum_cents`;
  console.log(`priced ${priced.count} jobs from their lines`);

  // 2. BILL THE FINISHED WORK. Copy each job's lines onto its invoice — an invoice with no lines
  //    cannot show what it is for, which is what made every one of them read "$0, no lines yet".
  const lines = await sql`
    insert into invoice_lines (org_id, invoice_id, source_job_line_id, description, quantity, rate_cents, cost_cents, position)
    select ${ORG}, i.id, jl.id, jl.description, jl.quantity, jl.rate_cents, coalesce(jl.cost_cents, 0),
           row_number() over (partition by i.id order by jl.id)
    from invoices i
    join job_lines jl on jl.job_id = i.source_job_id and jl.deleted_at is null
    where i.org_id = ${ORG} and i.deleted_at is null
      and not exists (select 1 from invoice_lines il where il.invoice_id = i.id)`;
  console.log(`copied ${lines.count} lines onto invoices`);

  const totals = await sql`
    update invoices i set total_cents = t.sum_cents, tax_bps = 0
    from (
      select il.invoice_id, sum(round(il.quantity * il.rate_cents))::int sum_cents
      from invoice_lines il where il.org_id = ${ORG} and il.deleted_at is null
      group by il.invoice_id
    ) t
    where i.id = t.invoice_id and i.org_id = ${ORG} and i.total_cents is distinct from t.sum_cents`;
  console.log(`totalled ${totals.count} invoices`);

  // 3. AGE THE LEDGER. A shop's invoices are not all one status: most are paid, some are out, a
  //    few are late, a couple are part-paid. Bucketed on a stable hash of the invoice number so a
  //    re-run lands every invoice in the same bucket rather than reshuffling the books.
  const aged = await sql`
    update invoices i set
      status = b.status,
      amount_paid_cents = b.paid_cents,
      sent_at = b.sent_at,
      due_at = b.sent_at + (i.terms_days || ' days')::interval
    from (
      select id,
             case bucket when 0 then 'paid' when 1 then 'sent' when 2 then 'partial' else 'sent' end status,
             case bucket when 0 then total_cents when 2 then (total_cents / 3) else 0 end paid_cents,
             -- overdue rows (bucket 3) were sent long enough ago that terms have lapsed
             now() - ((case bucket when 3 then 25 + (h % 60) else (h % 20) end) || ' days')::interval sent_at
      from (
        select id, total_cents,
               abs(hashtext(num)) % 100 h,
               case when abs(hashtext(num)) % 100 < 72 then 0    -- 72% paid
                    when abs(hashtext(num)) % 100 < 84 then 1    -- 12% sent, still in terms
                    when abs(hashtext(num)) % 100 < 90 then 2    --  6% part-paid
                    else 3 end bucket                            -- 10% overdue
        from invoices where org_id = ${ORG} and deleted_at is null and total_cents > 0
      ) x
    ) b
    where i.id = b.id and i.org_id = ${ORG}`;
  console.log(`aged ${aged.count} invoices across paid / sent / part-paid / overdue`);

  // 4. LEAVE A WORKLIST. Money's top half is "finished work nobody has billed". With every job
  //    invoiced that half is empty, and it is the half the screen exists for.
  const unbilled = await sql`
    delete from invoices where id in (
      select i.id from invoices i
      join jobs j on j.id = i.source_job_id
      where i.org_id = ${ORG} and i.deleted_at is null and j.status = 'complete'
        and abs(hashtext(i.num)) % 100 < 2
    )`;
  console.log(`left ${unbilled.count} finished jobs unbilled — the ready-to-bill worklist`);

  // 5. FILL THE PIPELINE.
  //
  // NOTE the second hash. Bucketing status on the SAME hash used to pick the customers meant the
  // two filters agreed with each other: only ids below 45 were selected, so the accepted and
  // declined branches could never be reached and the Won column stayed empty. Salting the hash is
  // what makes the two decisions independent.
  //
  // The board's columns are driven by quotes, and 28 across 607 customers is why it looked empty.
  // Quotes go to customers who have none yet, spread across the four statuses the columns read.
  const quotes = await sql`
    insert into estimates (org_id, num, lead_id, title, status, tax_bps, valid_days, sent_at, accepted_at, created_at)
    select ${ORG},
           'EST-' || (2000 + row_number() over (order by l.id)),
           l.id,
           (array['Water heater replacement','Repipe — copper to PEX','Sewer line repair',
                  'Drain clearing — main','Fixture package','Backflow certification'])[1 + (abs(hashtext(l.id::text)) % 6)],
           case when abs(hashtext(l.id::text || 'status')) % 100 < 15 then 'draft'
                when abs(hashtext(l.id::text || 'status')) % 100 < 50 then 'sent'
                when abs(hashtext(l.id::text || 'status')) % 100 < 90 then 'accepted'
                else 'declined' end,
           0, 30,
           case when abs(hashtext(l.id::text || 'status')) % 100 < 15 then null
                else now() - ((abs(hashtext(l.id::text)) % 40) || ' days')::interval end,
           case when abs(hashtext(l.id::text || 'status')) % 100 between 50 and 89
                then now() - ((abs(hashtext(l.id::text)) % 20) || ' days')::interval else null end,
           now() - ((abs(hashtext(l.id::text)) % 60) || ' days')::interval
    from leads l
    where l.org_id = ${ORG} and l.deleted_at is null
      and not exists (select 1 from estimates e where e.lead_id = l.id and e.deleted_at is null)
      and abs(hashtext(l.id::text)) % 100 < 45`;
  console.log(`wrote ${quotes.count} quotes across draft / sent / accepted / declined`);

  const qlines = await sql`
    insert into estimate_lines (org_id, estimate_id, description, quantity, rate_cents, cost_cents, position)
    select ${ORG}, e.id, e.title, 1,
           (35000 + (abs(hashtext(e.num)) % 40) * 2500),
           (12000 + (abs(hashtext(e.num)) % 20) * 900),
           1
    from estimates e
    where e.org_id = ${ORG} and e.deleted_at is null
      and not exists (select 1 from estimate_lines el where el.estimate_id = e.id)`;
  console.log(`priced ${qlines.count} quotes`);

  await show("after");
} finally {
  await sql.end({ timeout: 10 });
}
