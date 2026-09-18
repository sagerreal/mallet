/**
 * Scale seed: a plumbing shop dispatching ~20 jobs a day.
 *
 * This is both a demo environment and a load test. 20 jobs/day is a 5-6 tech shop — roughly 400
 * jobs a month — and it is the density at which the schedule board, the job list and the Money
 * screens stop being pretty and start being real.
 *
 * SHAPE
 *   6 technicians, ~600 customers, ~90 days of history and 2 weeks forward.
 *   ~20 jobs per weekday. Past jobs are completed and mostly invoiced (a realistic mix of paid,
 *   open and overdue). Today and forward are scheduled on the board.
 *
 * HOW IT WRITES
 *   Through the real tRPC API, so every record passes the same validation, RLS and business rules
 *   as a click in the UI. Run with bounded concurrency: the DB client caps at 10 connections and
 *   each mutation opens its own tenant transaction, so CONCURRENCY stays below that.
 *
 *   The one exception is the technician rows, inserted directly. Staff are org membership rather
 *   than a domain aggregate, and the real path (inviteMember) sends email and waits for signup —
 *   which cannot complete unattended. The integration fixtures in this repo create users the same
 *   way.
 *
 * ADDITIVE ONLY. Nothing is deleted. room_captures and painting_room_quantities are never
 * referenced, so the measurement data is untouched.
 *
 *   npx vitest run --config vitest.integration.config.ts scripts/seed-plumbing-scale
 */
import { describe, it } from "vitest";
import postgres from "postgres";
import { randomUUID } from "node:crypto";
import { appRouter } from "@/trpc/root";
import { asOrgId, asUserId, systemClock } from "@mallet/shared/types";
import { InMemoryEventBus, uuidGenerator } from "@mallet/shared/ports";
import { closeDb } from "@mallet/shared/db/client";

const ORG_ID = "6d2ceccc-e7bb-4d43-904d-d23c01cf9528";
const OWNER_ID = "f667e57e-7159-439a-b873-52d896e0fcd9";

/** Below the client's max:10 pool. Each mutation opens its own tenant tx = one connection. */
const CONCURRENCY = 6;
const DAYS_BACK = 90;
const DAYS_FORWARD = 14;
const JOBS_PER_DAY = 20;
const CUSTOMERS = 600;

const caller = () =>
  appRouter.createCaller({
    principal: { userId: asUserId(OWNER_ID), orgId: asOrgId(ORG_ID), role: "owner" },
    unmapped: null,
    tx: null,
    deps: {
      authProvider: { authenticate: async () => { throw new Error("unused"); } },
      bus: new InMemoryEventBus(), clock: systemClock, ids: uuidGenerator,
      paymentLinkGateway: null, connectGateway: null, photoStorageGateway: null, llmClient: null,
      apiKeyAuthenticator: { authenticate: async () => null },
      tokenVerifier: { verify: async () => null },
      signupStore: { createOrgForUser: async () => { throw new Error("unused"); } },
    },
  } as never);

/** Run tasks with a bounded worker pool; failures are collected, never thrown, so one bad record
 *  cannot abandon a 20-minute seed halfway through. */
async function pool<T>(items: readonly T[], fn: (item: T, i: number) => Promise<void>, label: string) {
  let next = 0, done = 0, failed = 0;
  const started = Date.now();
  const worker = async () => {
    for (;;) {
      const i = next++;
      if (i >= items.length) return;
      try { await fn(items[i]!, i); } catch { failed += 1; }
      done += 1;
      if (done % 100 === 0 || done === items.length) {
        const rate = done / ((Date.now() - started) / 1000);
        process.stdout.write(`\r  ${label}: ${done}/${items.length}  (${rate.toFixed(0)}/s, ${failed} failed)   `);
      }
    }
  };
  await Promise.all(Array.from({ length: CONCURRENCY }, worker));
  process.stdout.write("\n");
  return failed;
}

const FIRST = ["Dave","Maria","Tom","Priya","Greg","Anne","Marcus","Lena","Karl","Rosa","Ed","Joan","Sam","Nina","Hank","Bev","Luis","Dana","Phil","Kim","Ruth","Omar","Jill","Wes","Tara","Neil","Gina","Roy","Faye","Cole"];
const LAST = ["Chen","Delgado","Brennan","Nair","Salazar","Whitfield","Webb","Ortiz","Novak","Hayes","Okafor","Lindqvist","Ferraro","Boyd","Mackey","Trainor","Abbott","Reyes","Dunne","Whitaker","Sokolov","Ibarra","Kaminski","Pruitt","Vance"];
const STREETS = ["Oak Grove Rd","Ygnacio Valley Rd","Rudgear Dr","Tice Valley Blvd","Mount Diablo Blvd","Hartz Ave","N Main St","Camino Diablo","Danville Blvd","Treat Blvd","Geary Rd","Pleasant Hill Rd","Moraga Way","Alhambra Ave","San Ramon Valley Blvd"];
const CITIES = [["Walnut Creek","94596"],["Lafayette","94549"],["Danville","94526"],["Pleasant Hill","94523"],["Alamo","94507"],["Concord","94520"],["Orinda","94563"]];

/** Real dispatch mix for a residential plumbing shop: mostly small drain and fixture calls, a few
 *  big-ticket installs. The weighting is what makes the board look like a real day. */
const WORK: readonly [string, string, number][] = [
  ["Drain clearing — kitchen", "service", 32500],
  ["Drain clearing — main line", "service", 48500],
  ["Toilet repair / rebuild", "service", 28500],
  ["Water heater — no hot water", "service", 24500],
  ["Faucet replacement", "service", 34500],
  ["Garbage disposal replacement", "service", 46500],
  ["Angle stop / shutoff valve", "service", 18500],
  ["Leak under sink", "service", 29500],
  ["Hose bib replacement", "service", 22500],
  ["Water heater — 50gal install", "install", 285000],
  ["Pressure regulator replacement", "service", 62500],
  ["Sewer camera inspection", "inspection", 34500],
  ["Hydro-jetting — main sewer", "service", 68500],
  ["Slab leak detection", "diagnostic", 42500],
  ["Sump pump replacement", "install", 96500],
  ["Repipe estimate — visit", "estimate", 0],
];
const pick = <T,>(a: readonly T[], i: number): T => a[i % a.length]!;
const iso = (d: Date) => d.toISOString().slice(0, 10);
const addDays = (n: number) => { const d = new Date(); d.setDate(d.getDate() + n); return d; };

describe("seed: 20 jobs/day plumbing shop", () => {
  it("builds a shop at real dispatch density", async () => {
    const office = caller();
    const sql = postgres(process.env.DATABASE_URL as string, { ssl: "require", max: 2 });
    const t0 = Date.now();

    // ---- 1. Technicians -----------------------------------------------------------------
    const TECHS = ["Carlos Rivera","Dwayne Ellis","Mike Sorrentino","Ray Okonkwo","Tanya Brooks","Vic Petrosyan"];
    const techIds: string[] = [];
    for (const name of TECHS) {
      const email = `${name.split(" ")[0]!.toLowerCase()}@summitplumbing.test`;
      const [existing] = await sql<{ id: string }[]>`select id from users where org_id=${ORG_ID} and email=${email}`;
      if (existing) { techIds.push(existing.id); continue; }
      const [row] = await sql<{ id: string }[]>`
        insert into users (org_id, auth_user_id, email, name, role)
        values (${ORG_ID}, ${randomUUID()}, ${email}, ${name}, 'tech') returning id`;
      techIds.push(row!.id);
    }
    console.log(`\n✓ ${techIds.length} technicians`);

    // ---- 2. Customers -------------------------------------------------------------------
    const custIds: string[] = [];
    await pool(Array.from({ length: CUSTOMERS }, (_, i) => i), async (i) => {
      const [city, zip] = pick(CITIES, i);
      const lead = await office.v1.customers.create({
        name: `${pick(FIRST, i)} ${pick(LAST, Math.floor(i / 7) + i)}`,
        phone: `+1925${String(5550000 + i).slice(-7)}`,
        email: `cust${i}@example.com`,
        address: `${100 + (i * 7) % 3800} ${pick(STREETS, i)}, ${city}, CA ${zip}`,
      });
      custIds.push(lead.id);
    }, "customers");
    console.log(`✓ ${custIds.length} customers`);

    // ---- 3. Jobs, one per slot, weekdays only -------------------------------------------
    type Slot = { day: number; n: number };
    const slots: Slot[] = [];
    for (let day = -DAYS_BACK; day <= DAYS_FORWARD; day++) {
      const dow = addDays(day).getDay();
      if (dow === 0 || dow === 6) continue;             // no weekend dispatch
      for (let n = 0; n < JOBS_PER_DAY; n++) slots.push({ day, n });
    }
    console.log(`  ${slots.length} job slots across ${DAYS_BACK + DAYS_FORWARD} days`);

    const pastJobs: { id: string; cents: number }[] = [];
    await pool(slots, async (s, idx) => {
      const [title, svc, cents] = pick(WORK, idx * 3 + s.n);
      const leadId = pick(custIds, idx * 13);
      // 'estimate' rides in kind since 0133 — sending it as svc would re-mint the split-brain
      // rows that migration cleared, into the SHARED prod database, every benchmark run.
      const job = await office.v1.jobs.create(
        svc === "estimate" ? { leadId, title, kind: "estimate" } : { leadId, title, svc },
      );
      // A manual job is created with total_cents = 0 — it has no lines. Without this the invoice
      // comes out at $0 and recordPayment refuses it (amountCents must be positive), which is
      // exactly how the first run produced zero invoices while reporting success.
      if (cents > 0) {
        await office.v1.jobs.setLines({
          jobId: job.id,
          lines: [{ description: title, quantity: 1, rateCents: cents, costCents: Math.round(cents * 0.32) }],
        });
      }
      // Two techs share the morning, spread the rest — 20 jobs over 6 techs is 3-4 each.
      const tech = pick(techIds, s.n);
      const startHour = 7 + Math.floor(s.n / 3);         // 7am start, ~3 jobs per hour band
      await office.v1.visits.createVisit({
        jobId: job.id,
        assigneeUserId: tech,
        scheduledDate: iso(addDays(s.day)),
        scheduledStart: `${String(Math.min(startHour, 17)).padStart(2, "0")}:${s.n % 2 ? "30" : "00"}`,
        durationHours: cents > 100000 ? 3 : 1.5,
      });
      if (s.day < -1 && cents > 0) pastJobs.push({ id: job.id, cents });
    }, "jobs");
    console.log(`✓ ${slots.length} jobs on the board`);

    // ---- 4. Close out the past: start → complete → invoice -------------------------------
    // Only a slice gets billed; a real shop always has completed work waiting to be invoiced.
    const toBill = pastJobs.filter((_, i) => i % 3 !== 2);
    await pool(toBill, async (j, i) => {
      await office.v1.jobs.start({ jobId: j.id });
      await office.v1.jobs.complete({ jobId: j.id });
      const inv = await office.v1.invoicing.createFromJob({ jobId: j.id });
      if (inv.total.cents <= 0) return;                   // nothing to bill — never fake a payment
      if (i % 5 === 4) return;                            // leave some as drafts
      await office.v1.invoicing.send({ invoiceId: inv.id });
      if (i % 4 !== 3) {                                  // ~75% collected, rest outstanding
        await office.v1.invoicing.recordPayment({
          invoiceId: inv.id,
          amountCents: inv.total.cents,
          method: i % 3 === 0 ? "card" : "check",
          idempotencyKey: `scale-${inv.id}`,
        });
      }
    }, "invoices");

    await sql.end();
    console.log(`\n✓ done in ${((Date.now() - t0) / 1000 / 60).toFixed(1)} min`);
    console.log("  measurement data untouched — this script never references room_captures or painting_room_quantities\n");
    await closeDb();
  }, 3_600_000);
});
