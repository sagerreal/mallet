import { describe, it, expect, beforeAll, afterAll } from "vitest";
import postgres from "postgres";
import type { Sql } from "postgres";
import { randomUUID } from "node:crypto";
import { asOrgId, asUserId, systemClock } from "@mallet/shared/types";
import { InMemoryEventBus, uuidGenerator } from "@mallet/shared/ports";
import { closeDb } from "@mallet/shared/db/client";
import type { AuthProvider, Principal, Role } from "@mallet/identity";
import { appRouter } from "@/trpc/root";
import type { Context } from "@/trpc/init";

/**
 * The security properties of "a W-2 tech can take payment at the door", against the live database
 * with real RLS.
 *
 * The happy path is one test. The other eleven are the fence around it: what a technician must NOT
 * be able to reach, and — just as important — that the office surface did not change while this
 * was built.
 */
const hasDb = Boolean(process.env.APP_DATABASE_URL && process.env.DATABASE_URL);
const suite = hasDb ? describe : describe.skip;

const OUT_OF_SCOPE = "that invoice isn't on one of your jobs.";

const stubAuth: AuthProvider = {
  authenticate: async () => {
    throw new Error("authProvider should not be called in createCaller tests");
  },
};

const ctxFor = (userId: string, orgId: string, role: Role): Context => ({
  principal: { userId: asUserId(userId), orgId: asOrgId(orgId), role } satisfies Principal,
  unmapped: null,
  tx: null,
  deps: {
    authProvider: stubAuth,
    bus: new InMemoryEventBus(),
    clock: systemClock,
    ids: uuidGenerator,
    paymentLinkGateway: null,
    connectGateway: null,
    photoStorageGateway: null,
    llmClient: null,
    apiKeyAuthenticator: { authenticate: async () => null },
    tokenVerifier: { verify: async () => null },
    signupStore: {
      createOrgForUser: async () => {
        throw new Error("unused in this test");
      },
    },
  },
});

suite("v1.fieldInvoicing — a tech collects on their own job (live RLS)", () => {
  let admin: Sql;
  let orgAId = "";
  let orgBId = "";
  let techAId = "";
  let techBId = "";
  let ownerAId = "";
  let techInOrgBId = "";
  let leadAId = "";

  /** A completed, priced job in org A assigned to `assignee`. */
  const seedJob = async (
    assignee: string | null,
    status: string,
    opts: { totalCents?: number; kind?: string; orgId?: string; leadId?: string } = {},
  ): Promise<string> => {
    const org = opts.orgId ?? orgAId;
    const lead = opts.leadId ?? leadAId;
    const [job] = await admin<{ id: string }[]>`
      insert into jobs (
        org_id, lead_id, num, status, total_cents, kind, assignee_user_id,
        completed_at, canceled_at, cancel_reason
      )
      values (
        ${org}, ${lead}, ${"JOB-" + randomUUID().slice(0, 8)}, ${status},
        ${opts.totalCents ?? 100_000}, ${opts.kind ?? "work"}, ${assignee},
        ${status === "complete" ? new Date() : null},
        ${status === "canceled" ? new Date() : null},
        ${status === "canceled" ? "customer declined" : null}
      )
      returning id
    `;
    return job!.id;
  };

  /** A visit on `jobId` assigned to `assignee` — the job-level predicate must accept this too. */
  const seedVisit = async (jobId: string, assignee: string, status = "complete"): Promise<void> => {
    await admin`
      insert into job_visits (org_id, job_id, status, assignee_user_id, position)
      values (${orgAId}, ${jobId}, ${status}, ${assignee}, 0)
    `;
  };

  beforeAll(async () => {
    admin = postgres(process.env.DATABASE_URL as string, { max: 1, ssl: "require", prepare: false });

    const [a] = await admin<{ id: string }[]>`
      insert into orgs (name) values ('FieldInv A ' || gen_random_uuid()) returning id`;
    const [b] = await admin<{ id: string }[]>`
      insert into orgs (name) values ('FieldInv B ' || gen_random_uuid()) returning id`;
    orgAId = a!.id;
    orgBId = b!.id;

    const mkUser = async (org: string, email: string, role: string): Promise<string> => {
      const [u] = await admin<{ id: string }[]>`
        insert into users (org_id, auth_user_id, email, role)
        values (${org}, ${randomUUID()}, ${email}, ${role})
        returning id`;
      return u!.id;
    };
    techAId = await mkUser(orgAId, `techA-${randomUUID()}@fieldinv.test`, "tech");
    techBId = await mkUser(orgAId, `techB-${randomUUID()}@fieldinv.test`, "tech");
    ownerAId = await mkUser(orgAId, `owner-${randomUUID()}@fieldinv.test`, "owner");
    techInOrgBId = await mkUser(orgBId, `techB2-${randomUUID()}@fieldinv.test`, "tech");

    const [la] = await admin<{ id: string }[]>`
      insert into leads (org_id, name) values (${orgAId}, 'Doorstep Customer') returning id`;
    leadAId = la!.id;

    // The shop's visit fee lives in the booking blob, in DOLLARS. Seeded via admin.json — passing
    // a JS string and casting it ::jsonb stores a jsonb STRING, so `booking ->> 'serviceFee'`
    // reads null and the fee silently becomes $0.
    await admin`
      insert into org_settings (org_id, timezone, booking)
      values (${orgAId}, 'America/Denver',
        ${admin.json({ services: [], notServices: "", serviceFee: 89, feeCredited: false })})
    `;
  });

  afterAll(async () => {
    if (orgAId) {
      // Teardown order matters: job_visits carries a composite FK onto users (NO ACTION), so
      // cascading the org into users while a seeded visit still names one fails the whole delete.
      await admin`delete from job_visits where org_id in (${orgAId}, ${orgBId})`;
      await admin`delete from time_entries where org_id in (${orgAId}, ${orgBId})`;
      await admin`delete from orgs where id in (${orgAId}, ${orgBId})`;
    }
    await admin.end({ timeout: 5 });
    await closeDb();
  });

  // ── the happy path ────────────────────────────────────────────────────────────────────────

  it("a tech on the job bills it, sends it and takes cash at the door", async () => {
    const jobId = await seedJob(techAId, "complete");
    const tech = appRouter.createCaller(ctxFor(techAId, orgAId, "tech"));

    const invoice = await tech.v1.fieldInvoicing.createFromJob({ jobId });
    expect(invoice.status).toBe("draft");
    expect(invoice.total.cents).toBe(100_000);
    expect(invoice.sourceJobId).toBe(jobId);

    const sent = await tech.v1.fieldInvoicing.send({ invoiceId: invoice.id });
    expect(sent.status).toBe("sent");

    const paid = await tech.v1.fieldInvoicing.recordPayment({
      invoiceId: invoice.id,
      amountCents: 100_000,
      method: "cash",
      idempotencyKey: `field-pay-${invoice.id}`,
    });
    expect(paid.status).toBe("paid");
    expect(paid.due.cents).toBe(0);

    // And they can read it back — the poll the QR/card path depends on.
    const read = await tech.v1.fieldInvoicing.get({ invoiceId: invoice.id });
    expect(read.status).toBe("paid");
  });

  it("stamps the ledger with the tech who took the money", async () => {
    const jobId = await seedJob(techAId, "complete", { totalCents: 40_000 });
    const tech = appRouter.createCaller(ctxFor(techAId, orgAId, "tech"));
    const invoice = await tech.v1.fieldInvoicing.createFromJob({ jobId });
    await tech.v1.fieldInvoicing.send({ invoiceId: invoice.id });
    await tech.v1.fieldInvoicing.recordPayment({
      invoiceId: invoice.id,
      amountCents: 40_000,
      method: "cash",
      idempotencyKey: `attrib-${invoice.id}`,
    });

    // Without this column the shop cannot reconcile a drawer, and the only deterrent against
    // pocketing is theatre.
    const rows = await admin<{ recorded_by_user_id: string | null }[]>`
      select recorded_by_user_id from payments where org_id = ${orgAId} and invoice_id = ${invoice.id}`;
    expect(rows).toHaveLength(1);
    expect(rows[0]!.recorded_by_user_id).toBe(techAId);
  });

  it("a tech assigned only to a VISIT of the job can still collect", async () => {
    // Documents the job-LEVEL choice. On a two-visit job whichever assigned tech is at the door
    // when the customer pays must be able to take the money; tightening this to isAssignedToVisit
    // would break every multi-visit job.
    const jobId = await seedJob(techBId, "complete", { totalCents: 25_000 });
    await seedVisit(jobId, techAId);
    const tech = appRouter.createCaller(ctxFor(techAId, orgAId, "tech"));
    const invoice = await tech.v1.fieldInvoicing.createFromJob({ jobId });
    expect(invoice.total.cents).toBe(25_000);
  });

  // ── the fence ─────────────────────────────────────────────────────────────────────────────

  it("a tech NOT on the job is refused on every procedure", async () => {
    const jobId = await seedJob(techBId, "complete");
    const owner = appRouter.createCaller(ctxFor(ownerAId, orgAId, "owner"));
    const invoice = await owner.v1.invoicing.createFromJob({ jobId });
    await owner.v1.invoicing.send({ invoiceId: invoice.id });

    const intruder = appRouter.createCaller(ctxFor(techAId, orgAId, "tech"));

    // Job-ID-addressed: FORBIDDEN, naming the real problem (a tech legitimately holds job ids).
    await expect(intruder.v1.fieldInvoicing.createFromJob({ jobId })).rejects.toMatchObject({
      code: "FORBIDDEN",
      message: "this job isn't assigned to you",
    });
    await expect(intruder.v1.fieldInvoicing.raiseVisitFee({ jobId })).rejects.toMatchObject({
      code: "FORBIDDEN",
    });

    // Invoice-addressed: NOT_FOUND with the EXACT sentence. Asserting the string on purpose —
    // "improving" this into a helpful FORBIDDEN turns the endpoint into an existence oracle over
    // the shop's whole receivables book.
    await expect(intruder.v1.fieldInvoicing.get({ invoiceId: invoice.id })).rejects.toMatchObject({
      code: "NOT_FOUND",
      message: OUT_OF_SCOPE,
    });
    await expect(intruder.v1.fieldInvoicing.send({ invoiceId: invoice.id })).rejects.toMatchObject({
      code: "NOT_FOUND",
      message: OUT_OF_SCOPE,
    });
    await expect(
      intruder.v1.fieldInvoicing.recordPayment({
        invoiceId: invoice.id,
        amountCents: 100_000,
        method: "cash",
        idempotencyKey: `intruder-${invoice.id}`,
      }),
    ).rejects.toMatchObject({ code: "NOT_FOUND", message: OUT_OF_SCOPE });
    await expect(
      intruder.v1.fieldInvoicing.createPayment({ invoiceId: invoice.id }),
    ).rejects.toMatchObject({ code: "NOT_FOUND", message: OUT_OF_SCOPE });

    // Nothing was written by any of those attempts.
    const paid = await admin<{ n: string }[]>`
      select count(*) as n from payments where org_id = ${orgAId} and invoice_id = ${invoice.id}`;
    expect(Number(paid[0]!.n)).toBe(0);
  });

  it("a tech cannot touch a lead-tied invoice with both job links null", async () => {
    // The "same customer" framing is the point: this is a manual invoice for a lead the tech HAS
    // worked jobs for. No job link means no assignment, means no predicate — refused, always.
    await seedJob(techAId, "complete"); // techA genuinely works for this customer
    const owner = appRouter.createCaller(ctxFor(ownerAId, orgAId, "owner"));
    const manual = await owner.v1.invoicing.draft({
      leadId: leadAId,
      title: "Annual service plan",
      lines: [{ description: "Plan", quantity: 1, rateCents: 30_000 }],
    });
    expect(manual.sourceJobId).toBeNull();

    const tech = appRouter.createCaller(ctxFor(techAId, orgAId, "tech"));
    await expect(tech.v1.fieldInvoicing.get({ invoiceId: manual.id })).rejects.toMatchObject({
      code: "NOT_FOUND",
      message: OUT_OF_SCOPE,
    });
  });

  it("a cross-org tech is refused, and writes nothing in the other org", async () => {
    const jobId = await seedJob(techAId, "complete");
    const techA = appRouter.createCaller(ctxFor(techAId, orgAId, "tech"));
    const invoice = await techA.v1.fieldInvoicing.createFromJob({ jobId });
    await techA.v1.fieldInvoicing.send({ invoiceId: invoice.id });

    // Org B's tech holds org A's invoice id. RLS stops this before the guard ever runs.
    const outsider = appRouter.createCaller(ctxFor(techInOrgBId, orgBId, "tech"));
    await expect(outsider.v1.fieldInvoicing.get({ invoiceId: invoice.id })).rejects.toMatchObject({
      code: "NOT_FOUND",
    });
    await expect(
      outsider.v1.fieldInvoicing.recordPayment({
        invoiceId: invoice.id,
        amountCents: 100_000,
        method: "cash",
        idempotencyKey: `crossorg-${invoice.id}`,
      }),
    ).rejects.toMatchObject({ code: "NOT_FOUND" });

    const rows = await admin<{ n: string }[]>`
      select count(*) as n from payments where invoice_id = ${invoice.id}`;
    expect(Number(rows[0]!.n)).toBe(0);
    // The invoice is untouched in org A.
    const still = await techA.v1.fieldInvoicing.get({ invoiceId: invoice.id });
    expect(still.status).toBe("sent");
  });

  it("refuses a canceled job — and names the next step", async () => {
    const jobId = await seedJob(techAId, "canceled");
    const tech = appRouter.createCaller(ctxFor(techAId, orgAId, "tech"));
    await expect(tech.v1.fieldInvoicing.createFromJob({ jobId })).rejects.toMatchObject({
      code: "BAD_REQUEST",
      message: "This job was canceled — ask the office.",
    });
  });

  it("refuses a job that is not finished yet — the terminal-gate INVERSION", async () => {
    // Every other field write refuses job.isTerminal(), and `complete` IS terminal. Close-out runs
    // AFTER completion, so these procedures require complete instead. If someone ever pastes
    // isTerminal() in here, this test and the one above both flip.
    const jobId = await seedJob(techAId, "in_progress");
    const tech = appRouter.createCaller(ctxFor(techAId, orgAId, "tech"));
    await expect(tech.v1.fieldInvoicing.createFromJob({ jobId })).rejects.toMatchObject({
      code: "BAD_REQUEST",
      message: "Finish the job before taking payment.",
    });
  });

  it("refuses an invoice whose source job belongs to a colleague, even mid-flow", async () => {
    // techA raises and sends on their own job; the job is then REASSIGNED to techB. techA's next
    // call must be refused — authorization is evaluated per request, never cached on the invoice.
    const jobId = await seedJob(techAId, "complete", { totalCents: 15_000 });
    const techA = appRouter.createCaller(ctxFor(techAId, orgAId, "tech"));
    const invoice = await techA.v1.fieldInvoicing.createFromJob({ jobId });
    await techA.v1.fieldInvoicing.send({ invoiceId: invoice.id });

    await admin`update jobs set assignee_user_id = ${techBId} where id = ${jobId}`;

    await expect(
      techA.v1.fieldInvoicing.recordPayment({
        invoiceId: invoice.id,
        amountCents: 15_000,
        method: "cash",
        idempotencyKey: `reassigned-${invoice.id}`,
      }),
    ).rejects.toMatchObject({ code: "NOT_FOUND", message: OUT_OF_SCOPE });
  });

  // ── the declined-estimate trip fee, through the scope link ────────────────────────────────

  it("a tech raises AND collects the trip fee on a declined estimate visit", async () => {
    const jobId = await seedJob(techAId, "complete", { totalCents: 0, kind: "estimate" });
    const tech = appRouter.createCaller(ctxFor(techAId, orgAId, "tech"));

    const fee = await tech.v1.fieldInvoicing.raiseVisitFee({ jobId });
    // LEAD-tied, so it does not consume the job's one source_job_id slot — the customer may still
    // accept a quote on this job, and its real bill needs that slot.
    expect(fee.sourceJobId).toBeNull();
    expect(fee.scopeJobId).toBe(jobId);
    // The amount comes from the shop's settings ($89), never from the caller.
    expect(fee.total.cents).toBe(8_900);

    // And the scope link is what authorizes the collection.
    const sent = await tech.v1.fieldInvoicing.send({ invoiceId: fee.id });
    expect(sent.status).toBe("sent");
    const paid = await tech.v1.fieldInvoicing.recordPayment({
      invoiceId: fee.id,
      amountCents: 8_900,
      method: "cash",
      idempotencyKey: `fee-${fee.id}`,
    });
    expect(paid.status).toBe("paid");

    // The job's real invoice slot is still free.
    const owner = appRouter.createCaller(ctxFor(ownerAId, orgAId, "owner"));
    await admin`update jobs set total_cents = 25000 where id = ${jobId}`;
    const realBill = await owner.v1.invoicing.createFromJob({ jobId });
    expect(realBill.id).not.toBe(fee.id);
    expect(realBill.sourceJobId).toBe(jobId);
  });

  it("re-raising the fee returns the same invoice — never a second charge", async () => {
    // The client-side flow it replaces had no server idempotency at all: N flaky retries minted N
    // independently-sendable fee drafts in the shop's ledger.
    const jobId = await seedJob(techAId, "complete", { totalCents: 0, kind: "estimate" });
    const tech = appRouter.createCaller(ctxFor(techAId, orgAId, "tech"));
    const first = await tech.v1.fieldInvoicing.raiseVisitFee({ jobId });
    const second = await tech.v1.fieldInvoicing.raiseVisitFee({ jobId });
    expect(second.id).toBe(first.id);

    const rows = await admin<{ n: string }[]>`
      select count(*) as n from invoices where org_id = ${orgAId} and scope_job_id = ${jobId}`;
    expect(Number(rows[0]!.n)).toBe(1);
  });

  it("a tech cannot reach a scope-linked fee on somebody else's job", async () => {
    const jobId = await seedJob(techBId, "complete", { totalCents: 0, kind: "estimate" });
    const techB = appRouter.createCaller(ctxFor(techBId, orgAId, "tech"));
    const fee = await techB.v1.fieldInvoicing.raiseVisitFee({ jobId });

    const intruder = appRouter.createCaller(ctxFor(techAId, orgAId, "tech"));
    await expect(intruder.v1.fieldInvoicing.get({ invoiceId: fee.id })).rejects.toMatchObject({
      code: "NOT_FOUND",
      message: OUT_OF_SCOPE,
    });
  });

  // ── the arbitrary-invoice-overwrite hole, and the squattable ledger key ───────────────────

  it("raiseVisitFee cannot be aimed at another invoice — the input carries no id at all", async () => {
    // The hole this closes: `raiseVisitFee({jobId: <mine>, id: <a colleague's paid invoice>})`.
    // assertFieldJobScope validates the JOB and can say nothing about an id, so the write landed
    // wherever the caller aimed it — resetting a $5,000 paid bill to an $89 draft, nulling its
    // source_job_id, stranding its payments, and stamping the attacker's own job as scope_job_id,
    // which MANUFACTURED authorization over the very invoice `get` had just refused them.
    const victimJobId = await seedJob(techBId, "complete", { totalCents: 500_000 });
    const owner = appRouter.createCaller(ctxFor(ownerAId, orgAId, "owner"));
    const victim = await owner.v1.invoicing.createFromJob({ jobId: victimJobId });
    await owner.v1.invoicing.send({ invoiceId: victim.id });
    await owner.v1.invoicing.recordPayment({
      invoiceId: victim.id,
      amountCents: 500_000,
      method: "cash",
      idempotencyKey: `victim-${victim.id}`,
    });

    const attackerJobId = await seedJob(techAId, "complete", { totalCents: 0, kind: "estimate" });
    const attacker = appRouter.createCaller(ctxFor(techAId, orgAId, "tech"));

    // The attacker cannot read the victim invoice — that much was always true.
    await expect(attacker.v1.fieldInvoicing.get({ invoiceId: victim.id })).rejects.toMatchObject({
      code: "NOT_FOUND",
    });

    // The id is no longer part of the contract. Zod strips the unknown key (the house convention),
    // so the call still succeeds — but it is INERT: the fee lands on a fresh server-minted id and
    // cannot address the invoice the caller named.
    const fee = await (
      attacker.v1.fieldInvoicing.raiseVisitFee as unknown as (a: {
        jobId: string;
        id: string;
      }) => Promise<{ id: string; scopeJobId: string | null; total: { cents: number } }>
    )({ jobId: attackerJobId, id: victim.id });

    expect(fee.id).not.toBe(victim.id);
    expect(fee.scopeJobId).toBe(attackerJobId);
    expect(fee.total.cents).toBe(8_900);

    // The victim is byte-for-byte intact: still paid, still $5,000, still tied to its own job.
    const after = await owner.v1.invoicing.get({ invoiceId: victim.id });
    expect(after.status).toBe("paid");
    expect(after.total.cents).toBe(500_000);
    expect(after.sourceJobId).toBe(victimJobId);
    expect(after.amountPaid.cents).toBe(500_000);

    // And no scope link was manufactured onto it.
    const rows = await admin<{ scope_job_id: string | null }[]>`
      select scope_job_id from invoices where id = ${victim.id}`;
    expect(rows[0]!.scope_job_id).toBeNull();
  });

  it("the office draft path cannot overwrite an existing invoice either", async () => {
    // Same shape, still owner/office-only, hardened at the REPOSITORY so both callers are covered:
    // the draft path inserts non-destructively instead of upserting.
    const jobId = await seedJob(techAId, "complete", { totalCents: 500_000 });
    const owner = appRouter.createCaller(ctxFor(ownerAId, orgAId, "owner"));
    const victim = await owner.v1.invoicing.createFromJob({ jobId });

    await expect(
      owner.v1.invoicing.draft({
        id: victim.id, // aimed at the invoice above
        leadId: leadAId,
        title: "Overwrite attempt",
        lines: [{ description: "x", quantity: 1, rateCents: 100 }],
      }),
    ).rejects.toBeTruthy();

    const after = await owner.v1.invoicing.get({ invoiceId: victim.id });
    expect(after.total.cents).toBe(500_000);
    expect(after.sourceJobId).toBe(jobId);
  });

  it("two concurrent raises mint ONE fee invoice, not two", async () => {
    // findExistingFee is a read-then-write: under READ COMMITTED both transactions see nothing and
    // both insert. Only invoices_org_scope_job_uidx can refuse the second — and this is precisely
    // the double-tap-on-a-flaky-connection case the use-case exists to make safe.
    const jobId = await seedJob(techAId, "complete", { totalCents: 0, kind: "estimate" });
    const a = appRouter.createCaller(ctxFor(techAId, orgAId, "tech"));
    const b = appRouter.createCaller(ctxFor(techAId, orgAId, "tech"));

    const results = await Promise.allSettled([
      a.v1.fieldInvoicing.raiseVisitFee({ jobId }),
      b.v1.fieldInvoicing.raiseVisitFee({ jobId }),
    ]);
    // Neither is allowed to fail: the loser re-reads and returns the winner.
    expect(results.filter((r) => r.status === "fulfilled")).toHaveLength(2);

    const rows = await admin<{ n: string }[]>`
      select count(*) as n from invoices
      where org_id = ${orgAId} and scope_job_id = ${jobId} and status <> 'void'`;
    expect(Number(rows[0]!.n)).toBe(1);
  });

  it("a tech cannot squat an idempotency key another payment would use", async () => {
    // payments dedupes on (org_id, idempotency_key) ACROSS THE SHOP, so a raw caller-chosen key is
    // a global slot. Claim "K" on your own invoice and the next legitimate payment using "K" — any
    // invoice, anyone — is silently swallowed as a retry and real money leaves no ledger row.
    const squattedKey = "shared-key-0001";

    const mineJobId = await seedJob(techAId, "complete", { totalCents: 5_000 });
    const tech = appRouter.createCaller(ctxFor(techAId, orgAId, "tech"));
    const mine = await tech.v1.fieldInvoicing.createFromJob({ jobId: mineJobId });
    await tech.v1.fieldInvoicing.send({ invoiceId: mine.id });
    await tech.v1.fieldInvoicing.recordPayment({
      invoiceId: mine.id,
      amountCents: 5_000,
      method: "cash",
      idempotencyKey: squattedKey,
    });

    // A different invoice, the same client key. It must land as a REAL payment.
    const otherJobId = await seedJob(techAId, "complete", { totalCents: 70_000 });
    const other = await tech.v1.fieldInvoicing.createFromJob({ jobId: otherJobId });
    await tech.v1.fieldInvoicing.send({ invoiceId: other.id });
    const paid = await tech.v1.fieldInvoicing.recordPayment({
      invoiceId: other.id,
      amountCents: 70_000,
      method: "cash",
      idempotencyKey: squattedKey,
    });
    expect(paid.status).toBe("paid");
    expect(paid.amountPaid.cents).toBe(70_000);

    // The office's own raw key is in a different namespace again, so it cannot be squatted either.
    const officeJobId = await seedJob(techBId, "complete", { totalCents: 9_000 });
    const owner = appRouter.createCaller(ctxFor(ownerAId, orgAId, "owner"));
    const officeInv = await owner.v1.invoicing.createFromJob({ jobId: officeJobId });
    await owner.v1.invoicing.send({ invoiceId: officeInv.id });
    const officePaid = await owner.v1.invoicing.recordPayment({
      invoiceId: officeInv.id,
      amountCents: 9_000,
      method: "cash",
      idempotencyKey: squattedKey,
    });
    expect(officePaid.status).toBe("paid");
  });

  it("a genuine retry on the same invoice still dedupes", async () => {
    // The namespacing must not break what idempotency keys are FOR.
    const jobId = await seedJob(techAId, "complete", { totalCents: 30_000 });
    const tech = appRouter.createCaller(ctxFor(techAId, orgAId, "tech"));
    const invoice = await tech.v1.fieldInvoicing.createFromJob({ jobId });
    await tech.v1.fieldInvoicing.send({ invoiceId: invoice.id });
    const args = {
      invoiceId: invoice.id,
      amountCents: 30_000,
      method: "cash" as const,
      idempotencyKey: `retry-${invoice.id}`,
    };
    await tech.v1.fieldInvoicing.recordPayment(args);
    const again = await tech.v1.fieldInvoicing.recordPayment(args);
    expect(again.amountPaid.cents).toBe(30_000); // not 60_000
  });

  // ── what crosses the wire, and what did not change ────────────────────────────────────────

  it("the field DTO carries the balance but never the pay-link or cost", async () => {
    const jobId = await seedJob(techAId, "complete", { totalCents: 60_000 });
    const tech = appRouter.createCaller(ctxFor(techAId, orgAId, "tech"));
    const invoice = (await tech.v1.fieldInvoicing.createFromJob({ jobId })) as unknown as Record<
      string,
      unknown
    >;
    expect(invoice.total).toEqual({ cents: 60_000, currency: "USD" });
    expect(invoice.due).toEqual({ cents: 60_000, currency: "USD" });
    for (const forbidden of ["publicToken", "publicUrl", "authorization", "poNumber", "taxBps"]) {
      expect(invoice[forbidden], `${forbidden} must never reach a tech`).toBeUndefined();
    }
  });

  it("carries the document facts a customer is handed at the door", async () => {
    // The close-out sheet a technician turns around renders the SAME <InvoiceDocument> as the
    // customer's own /i/<token> page. Without these two it was a different document: no service
    // address, no service date. Neither is new information to the person being handed it.
    const leadId = await (async () => {
      const [l] = await admin<{ id: string }[]>`
        insert into leads (org_id, name, address)
        values (${orgAId}, 'Doorstep Addressed', '18 Aspen Ct, Dublin, CA 94568')
        returning id`;
      return l!.id;
    })();
    const jobId = await seedJob(techAId, "complete", { totalCents: 42_000, leadId });
    const serviceAt = new Date("2026-08-03T16:20:00.000Z");
    await admin`
      insert into job_visits (org_id, job_id, status, assignee_user_id, completed_at, position)
      values (${orgAId}, ${jobId}, 'complete', ${techAId}, ${serviceAt}, 0)`;

    const tech = appRouter.createCaller(ctxFor(techAId, orgAId, "tech"));
    const invoice = await tech.v1.fieldInvoicing.createFromJob({ jobId });
    expect(invoice.customerName).toBe("Doorstep Addressed");
    expect(invoice.serviceAddress).toBe("18 Aspen Ct, Dublin, CA 94568");
    expect(invoice.serviceAt).toBe(serviceAt.toISOString());
  });

  it("states NO service date when no visit has completed — never the invoice date", async () => {
    // A customer may keep this. A date that is not the service date under a "Service" label is a
    // false statement on a document someone else may rely on.
    const jobId = await seedJob(techAId, "complete", { totalCents: 9_000 });
    const tech = appRouter.createCaller(ctxFor(techAId, orgAId, "tech"));
    const invoice = await tech.v1.fieldInvoicing.createFromJob({ jobId });
    expect(invoice.serviceAt).toBeNull();
    expect(invoice.createdAt).toEqual(expect.any(String));
  });

  it("the OFFICE procedures are unchanged — a tech is still refused by every one", async () => {
    // The regression fence around the whole design. If any of these starts passing, the sibling
    // router was quietly turned into a role widening.
    const jobId = await seedJob(techAId, "complete");
    const tech = appRouter.createCaller(ctxFor(techAId, orgAId, "tech"));
    const invoice = await tech.v1.fieldInvoicing.createFromJob({ jobId });

    const forbidden = [
      () => tech.v1.invoicing.get({ invoiceId: invoice.id }),
      () => tech.v1.invoicing.list({}),
      () => tech.v1.invoicing.totals(),
      () => tech.v1.invoicing.count({}),
      () => tech.v1.invoicing.listByLead({ leadId: leadAId }),
      () => tech.v1.invoicing.listOverdue({}),
      () => tech.v1.invoicing.void({ invoiceId: invoice.id }),
      () => tech.v1.invoicing.updateMetadata({ invoiceId: invoice.id, depositPaidCents: 100_000 }),
      () => tech.v1.invoicing.patchLines({ invoiceId: invoice.id, lines: [] }),
      () =>
        tech.v1.invoicing.draft({
          leadId: leadAId,
          lines: [{ description: "x", quantity: 1, rateCents: 1 }],
        }),
      () => tech.v1.invoicing.setFollowUp({ invoiceId: invoice.id, on: true, stage: 1 }),
      () => tech.v1.invoicing.createFromJob({ jobId }),
      () => tech.v1.invoicing.send({ invoiceId: invoice.id }),
      () =>
        tech.v1.invoicing.recordPayment({
          invoiceId: invoice.id,
          amountCents: 1,
          method: "cash",
          idempotencyKey: `office-path-${invoice.id}`,
        }),
    ];
    for (const call of forbidden) {
      await expect(call()).rejects.toMatchObject({ code: "FORBIDDEN" });
    }
  });

  it("owner and office keep the field router too, unredacted and unguarded by assignment", async () => {
    // anyRole means owner/office pass through — they already hold the office surface, and the
    // guard returns null for them rather than asking about assignment.
    const jobId = await seedJob(techBId, "complete", { totalCents: 12_000 });
    const owner = appRouter.createCaller(ctxFor(ownerAId, orgAId, "owner"));
    const invoice = await owner.v1.fieldInvoicing.createFromJob({ jobId });
    expect(invoice.total.cents).toBe(12_000);
    expect(invoice.lines.every((l) => l.rate !== null)).toBe(true);
  });

  it("hides line rates but never the balance when the shop hides prices", async () => {
    // A1: you cannot collect $840 without displaying "$840". The setting keeps governing the
    // per-line breakdown and stops governing the amount the tech is there to collect.
    await admin`update org_settings set tech_sees_price = false where org_id = ${orgAId}`;
    try {
      const jobId = await seedJob(techAId, "complete", { totalCents: 84_000 });
      await admin`
        insert into job_lines (org_id, job_id, description, quantity, rate_cents, cost_cents, position)
        values (${orgAId}, ${jobId}, 'Water heater', 1, 84000, 41000, 0)`;
      const tech = appRouter.createCaller(ctxFor(techAId, orgAId, "tech"));
      const invoice = await tech.v1.fieldInvoicing.createFromJob({ jobId });

      expect(invoice.total.cents).toBe(84_000);
      expect(invoice.due.cents).toBe(84_000);
      expect(invoice.lines).not.toHaveLength(0);
      expect(invoice.lines.every((l) => l.rate === null)).toBe(true);
    } finally {
      await admin`update org_settings set tech_sees_price = true where org_id = ${orgAId}`;
    }
  });
});
