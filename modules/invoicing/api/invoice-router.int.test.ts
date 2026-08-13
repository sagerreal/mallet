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

// Capstone: the WHOLE money loop end-to-end via createCaller — quote -> accept -> job -> complete
// -> invoice -> pay -> paid — across four modules, all under live RLS. org B sees nothing; a tech
// is forbidden.
const hasDb = Boolean(process.env.APP_DATABASE_URL && process.env.DATABASE_URL);
const suite = hasDb ? describe : describe.skip;

const stubAuth: AuthProvider = {
  authenticate: async () => {
    throw new Error("authProvider should not be called in createCaller tests");
  },
};

const ctxFor = (orgId: string, role: Role): Context => ({
  principal: { userId: asUserId(randomUUID()), orgId: asOrgId(orgId), role } satisfies Principal,
  unmapped: null,
  tx: null,
  deps: { authProvider: stubAuth, bus: new InMemoryEventBus(), clock: systemClock, ids: uuidGenerator, paymentLinkGateway: null, connectGateway: null, photoStorageGateway: null, llmClient: null, apiKeyAuthenticator: { authenticate: async () => null }, tokenVerifier: { verify: async () => null }, signupStore: { createOrgForUser: async () => { throw new Error("unused in this test"); } } },
});

suite("invoicing tRPC router (full money loop, live RLS)", () => {
  let admin: Sql;
  let orgAId = "";
  let orgBId = "";
  let leadAId = "";

  beforeAll(async () => {
    admin = postgres(process.env.DATABASE_URL as string, { max: 1, ssl: "require", prepare: false });
    const [a] = await admin<{ id: string }[]>`insert into orgs (name) values ('InvApi A ' || gen_random_uuid()) returning id`;
    const [b] = await admin<{ id: string }[]>`insert into orgs (name) values ('InvApi B ' || gen_random_uuid()) returning id`;
    orgAId = a!.id;
    orgBId = b!.id;
    const [la] = await admin<{ id: string }[]>`insert into leads (org_id, name) values (${orgAId}, 'Cust A') returning id`;
    leadAId = la!.id;
  });

  afterAll(async () => {
    if (orgAId) await admin`delete from orgs where id in (${orgAId}, ${orgBId})`;
    await admin.end({ timeout: 5 });
    await closeDb();
  });

  // Drive quote -> accept -> job -> complete, returning the completed job id.
  const completedJobId = async (caller: ReturnType<typeof appRouter.createCaller>): Promise<string> => {
    const estimate = await caller.v1.quoting.draft({
      leadId: leadAId,
      title: "Deck",
      lines: [{ description: "Labor", quantity: 10, rateCents: 10_000 }], // $1000.00
    });
    await caller.v1.quoting.send({ estimateId: estimate.id });
    await caller.v1.quoting.accept({ estimateId: estimate.id });
    const job = await caller.v1.jobs.createFromEstimate({ estimateId: estimate.id });
    await caller.v1.jobs.start({ jobId: job.id });
    await caller.v1.jobs.complete({ jobId: job.id });
    return job.id;
  };

  it("bills a completed job and takes it to paid (idempotently)", async () => {
    const caller = appRouter.createCaller(ctxFor(orgAId, "owner"));
    const jobId = await completedJobId(caller);

    const invoice = await caller.v1.invoicing.createFromJob({ jobId });
    expect(invoice.status).toBe("draft");
    expect(invoice.num).toMatch(/^INV-\d+$/);
    expect(invoice.total.cents).toBe(100_000);
    expect(invoice.due.cents).toBe(100_000);

    // Idempotent create.
    const again = await caller.v1.invoicing.createFromJob({ jobId });
    expect(again.id).toBe(invoice.id);

    const sent = await caller.v1.invoicing.send({ invoiceId: invoice.id });
    expect(sent.status).toBe("sent");
    expect(sent.dueAt).toBeTruthy();

    const paid = await caller.v1.invoicing.recordPayment({
      invoiceId: invoice.id,
      amountCents: 100_000,
      method: "cash",
      idempotencyKey: `pay-${invoice.id}`,
    });
    expect(paid.status).toBe("paid");
    expect(paid.due.cents).toBe(0);

    // Idempotent payment: same key does not double-apply.
    const repeat = await caller.v1.invoicing.recordPayment({
      invoiceId: invoice.id,
      amountCents: 100_000,
      method: "cash",
      idempotencyKey: `pay-${invoice.id}`,
    });
    expect(repeat.amountPaid.cents).toBe(100_000); // not 200000
  });

  it("rejects createFromJob when the job is not complete (CONFLICT)", async () => {
    const caller = appRouter.createCaller(ctxFor(orgAId, "owner"));
    const job = await caller.v1.jobs.scheduleDirect({ leadId: leadAId, title: "Not done" });
    await expect(caller.v1.invoicing.createFromJob({ jobId: job.id })).rejects.toMatchObject({
      code: "CONFLICT",
    });
  });

  it("a different org sees no invoices", async () => {
    const caller = appRouter.createCaller(ctxFor(orgBId, "owner"));
    const listed = await caller.v1.invoicing.list({ limit: 50 });
    expect(listed.items).toHaveLength(0);
  });

  it("a tech is forbidden from the invoicing API", async () => {
    const caller = appRouter.createCaller(ctxFor(orgAId, "tech"));
    await expect(caller.v1.invoicing.list({ limit: 10 })).rejects.toMatchObject({ code: "FORBIDDEN" });
  });

  it("updateMetadata persists terms/title/deposit on a draft invoice", async () => {
    const caller = appRouter.createCaller(ctxFor(orgAId, "owner"));
    const draft = await caller.v1.invoicing.draft({
      leadId: leadAId,
      title: "Editable",
      lines: [{ description: "Labor", quantity: 1, rateCents: 100_000 }],
    });

    const updated = await caller.v1.invoicing.updateMetadata({
      invoiceId: draft.id,
      title: "Renamed",
      termsDays: 30,
      depositPaidCents: 25_000,
    });
    expect(updated.title).toBe("Renamed");
    expect(updated.termsDays).toBe(30);
    expect(updated.depositPaid.cents).toBe(25_000);
    // due = total(100000) - deposit(25000) - paid(0)
    expect(updated.due.cents).toBe(75_000);

    // Survives a re-fetch.
    const reloaded = await caller.v1.invoicing.get({ invoiceId: draft.id });
    expect(reloaded.termsDays).toBe(30);
    expect(reloaded.depositPaid.cents).toBe(25_000);
  });

  it("drafts with a discount and tax, and the money reaches the database", async () => {
    // The sheet showed Discount % and Tax % and sent neither, so the customer was billed the full
    // undiscounted sum and a shop that typed its sales-tax rate ate the tax.
    const caller = appRouter.createCaller(ctxFor(orgAId, "owner"));

    const draft = await caller.v1.invoicing.draft({
      leadId: leadAId,
      title: "Rated",
      discBps: 1_000,
      taxBps: 875,
      lines: [{ description: "Labor", quantity: 1, rateCents: 100_000 }],
    });

    expect(draft.discBps).toBe(1_000);
    expect(draft.discount.cents).toBe(10_000);
    expect(draft.taxBps).toBe(875);
    expect(draft.tax.cents).toBe(7_875); // 8.75% of the discounted $900, not of $1000
    expect(draft.total.cents).toBe(97_875);

    const reloaded = await caller.v1.invoicing.get({ invoiceId: draft.id });
    expect(reloaded.total.cents).toBe(97_875);
    expect(reloaded.tax.cents).toBe(7_875);
    expect(reloaded.discount.cents).toBe(10_000);
  });

  it("updateMetadata re-derives the bill when the rate changes", async () => {
    const caller = appRouter.createCaller(ctxFor(orgAId, "owner"));
    const draft = await caller.v1.invoicing.draft({
      leadId: leadAId,
      title: "Rate change",
      lines: [{ description: "Labor", quantity: 1, rateCents: 100_000 }],
    });
    expect(draft.total.cents).toBe(100_000);

    const updated = await caller.v1.invoicing.updateMetadata({
      invoiceId: draft.id,
      discBps: 2_000,
    });

    expect(updated.discount.cents).toBe(20_000);
    expect(updated.total.cents).toBe(80_000);

    const reloaded = await caller.v1.invoicing.get({ invoiceId: draft.id });
    expect(reloaded.total.cents).toBe(80_000);
  });

  it("patchLines keeps the invoice's discount instead of re-billing the gross", async () => {
    // editLines recomputed the total as a plain line sum, so editing a line on a discounted
    // invoice silently charged the full undiscounted amount.
    const caller = appRouter.createCaller(ctxFor(orgAId, "owner"));
    const draft = await caller.v1.invoicing.draft({
      leadId: leadAId,
      title: "Line edit",
      discBps: 1_000,
      lines: [{ description: "Labor", quantity: 1, rateCents: 100_000 }],
    });
    expect(draft.total.cents).toBe(90_000);

    const patched = await caller.v1.invoicing.patchLines({
      invoiceId: draft.id,
      lines: [{ description: "Labor", quantity: 1, rateCents: 200_000 }],
    });

    expect(patched.discount.cents).toBe(20_000);
    expect(patched.total.cents).toBe(180_000); // not the gross 200000
  });

  it("refuses a discount over 100%", async () => {
    const caller = appRouter.createCaller(ctxFor(orgAId, "owner"));
    await expect(
      caller.v1.invoicing.draft({
        leadId: leadAId,
        title: "Bad rate",
        discBps: 15_000,
        lines: [{ description: "Labor", quantity: 1, rateCents: 100_000 }],
      }),
    ).rejects.toThrow();
  });

  it("updateMetadata edits a SENT invoice too", async () => {
    const caller = appRouter.createCaller(ctxFor(orgAId, "owner"));
    const draft = await caller.v1.invoicing.draft({
      leadId: leadAId, title: "S", lines: [{ description: "L", quantity: 1, rateCents: 50_000 }],
    });
    await caller.v1.invoicing.send({ invoiceId: draft.id });
    const edited = await caller.v1.invoicing.updateMetadata({ invoiceId: draft.id, termsDays: 14 });
    expect(edited.status).toBe("sent");
    expect(edited.termsDays).toBe(14);
  });

  it("patchLines replaces lines and recomputes the total", async () => {
    const caller = appRouter.createCaller(ctxFor(orgAId, "owner"));
    const draft = await caller.v1.invoicing.draft({
      leadId: leadAId, title: "P", lines: [{ description: "Old", quantity: 1, rateCents: 10_000 }],
    });
    const patched = await caller.v1.invoicing.patchLines({
      invoiceId: draft.id,
      lines: [
        { description: "New A", quantity: 2, rateCents: 20_000 },
        { description: "New B", quantity: 1, rateCents: 5_000 },
      ],
    });
    expect(patched.lines).toHaveLength(2);
    expect(patched.total.cents).toBe(45_000);

    const reloaded = await caller.v1.invoicing.get({ invoiceId: draft.id });
    expect(reloaded.lines).toHaveLength(2);
    expect(reloaded.total.cents).toBe(45_000);
  });

  it("rejects updateMetadata on a paid invoice (BAD_REQUEST)", async () => {
    const caller = appRouter.createCaller(ctxFor(orgAId, "owner"));
    const draft = await caller.v1.invoicing.draft({
      leadId: leadAId, title: "Paid", lines: [{ description: "L", quantity: 1, rateCents: 40_000 }],
    });
    await caller.v1.invoicing.send({ invoiceId: draft.id });
    await caller.v1.invoicing.recordPayment({
      invoiceId: draft.id, amountCents: 40_000, method: "cash", idempotencyKey: `edit-${draft.id}`,
    });
    await expect(
      caller.v1.invoicing.updateMetadata({ invoiceId: draft.id, termsDays: 30 }),
    ).rejects.toMatchObject({ code: "BAD_REQUEST" });
  });

  it("a tech is forbidden from updateMetadata", async () => {
    const caller = appRouter.createCaller(ctxFor(orgAId, "tech"));
    await expect(
      caller.v1.invoicing.updateMetadata({ invoiceId: randomUUID(), termsDays: 30 }),
    ).rejects.toMatchObject({ code: "FORBIDDEN" });
  });

  it("a different org cannot edit org A's invoice (not_found under RLS)", async () => {
    const callerA = appRouter.createCaller(ctxFor(orgAId, "owner"));
    const draft = await callerA.v1.invoicing.draft({
      leadId: leadAId, title: "Iso", lines: [{ description: "L", quantity: 1, rateCents: 1_000 }],
    });
    const callerB = appRouter.createCaller(ctxFor(orgBId, "owner"));
    await expect(
      callerB.v1.invoicing.patchLines({ invoiceId: draft.id, lines: [] }),
    ).rejects.toMatchObject({ code: "NOT_FOUND" });
  });
});
