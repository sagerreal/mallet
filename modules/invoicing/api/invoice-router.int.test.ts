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
  tx: null,
  deps: { authProvider: stubAuth, bus: new InMemoryEventBus(), clock: systemClock, ids: uuidGenerator, paymentLinkGateway: null, llmClient: null , apiKeyAuthenticator: { authenticate: async () => null } },
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
});
