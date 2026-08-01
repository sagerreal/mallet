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
 * The fields that were accepted and thrown away.
 *
 * `addr` and `phone` were in the create input and dropped in the use-case for want of columns.
 * `completion` and `invRequested` never reached the wire at all — the store's payload builder
 * filtered them out. So the office job modal's Service address row and the close-out sheet's
 * "What was done" wrote to the browser and nowhere else, and the next jobs.list refetch erased
 * what had been typed.
 *
 * These assertions go through the real router against the real database, because the previous
 * bug was invisible to every unit test: the client "saved" successfully every time.
 */
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

suite("job fields that used to be dropped (live DB)", () => {
  let admin: Sql;
  let orgId = "";
  let leadId = "";

  beforeAll(async () => {
    admin = postgres(process.env.DATABASE_URL as string, { max: 1, ssl: "require", prepare: false });
    const [o] = await admin<{ id: string }[]>`
      insert into orgs (name) values ('DroppedFields ' || gen_random_uuid()) returning id`;
    orgId = o!.id;
    const lead = await appRouter
      .createCaller(ctxFor(orgId, "owner"))
      .v1.customers.create({ name: "Marta Reyes", phone: "(555) 640-2211" });
    leadId = lead.id;
  });

  afterAll(async () => {
    if (orgId) await admin`delete from orgs where id = ${orgId}`;
    await admin.end({ timeout: 5 });
    await closeDb();
  });

  const newJob = () =>
    appRouter.createCaller(ctxFor(orgId, "owner")).v1.jobs.create({
      id: randomUUID(),
      leadId,
      title: "Slab leak",
    });

  it("keeps an address given at creation — it was accepted and discarded", async () => {
    const caller = appRouter.createCaller(ctxFor(orgId, "owner"));
    const created = await caller.v1.jobs.create({
      id: randomUUID(),
      leadId,
      title: "Repipe",
      addr: "482 Pine St, Unit 3",
      phone: "(555) 900-1234",
    });
    const read = await caller.v1.jobs.get({ jobId: created.id });
    expect(read.addr).toBe("482 Pine St, Unit 3");
    expect(read.phone).toBe("(555) 900-1234");
  });

  it("keeps a service address typed into the job modal after creation", async () => {
    const caller = appRouter.createCaller(ctxFor(orgId, "owner"));
    const job = await newJob();
    await caller.v1.jobs.update({ jobId: job.id, addr: "1200 Ridge Rd" });
    expect((await caller.v1.jobs.get({ jobId: job.id })).addr).toBe("1200 Ridge Rd");
  });

  it("keeps the completion note — it is shown to the customer on the invoice", async () => {
    const caller = appRouter.createCaller(ctxFor(orgId, "owner"));
    const job = await newJob();
    await caller.v1.jobs.update({ jobId: job.id, completion: "Replaced 40-gal water heater" });
    expect((await caller.v1.jobs.get({ jobId: job.id })).completion).toBe("Replaced 40-gal water heater");
  });

  it("keeps the ready-to-bill flag the tech set", async () => {
    const caller = appRouter.createCaller(ctxFor(orgId, "owner"));
    const job = await newJob();
    await caller.v1.jobs.update({ jobId: job.id, invRequested: true });
    expect((await caller.v1.jobs.get({ jobId: job.id })).invRequested).toBe(true);
  });

  it("clears an address back to none when the field is emptied", async () => {
    const caller = appRouter.createCaller(ctxFor(orgId, "owner"));
    const job = await newJob();
    await caller.v1.jobs.update({ jobId: job.id, addr: "1200 Ridge Rd" });
    await caller.v1.jobs.update({ jobId: job.id, addr: "" });
    expect((await caller.v1.jobs.get({ jobId: job.id })).addr).toBeNull();
  });

  it("carries the address on the LIST read too — the board reads that shape", async () => {
    const caller = appRouter.createCaller(ctxFor(orgId, "owner"));
    const job = await newJob();
    await caller.v1.jobs.update({ jobId: job.id, addr: "77 Marina Blvd" });
    const page = await caller.v1.jobs.list({ limit: 50 });
    expect(page.items.find((j) => j.id === job.id)?.addr).toBe("77 Marina Blvd");
  });

  // Same defect class, different slice: the store's lead payload builder dropped it, so the
  // answer to "why did we lose this one?" was gone by the next refetch.
  it("keeps the loss reason on a customer", async () => {
    const caller = appRouter.createCaller(ctxFor(orgId, "owner"));
    const lead = await caller.v1.customers.create({ name: "Dell Warren", phone: "(555) 771-3300" });
    await caller.v1.customers.update({ leadId: lead.id, lossReason: "Went with a cheaper bid" });
    expect((await caller.v1.customers.get({ leadId: lead.id })).lossReason).toBe("Went with a cheaper bid");
  });
});
