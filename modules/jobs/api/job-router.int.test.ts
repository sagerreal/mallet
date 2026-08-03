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

// Capstone: the whole jobs stack via createCaller, including the cross-module estimate->job path.
// Owner in org A quotes an estimate (quoting), accepts it, then creates a job from it; the job runs
// through its lifecycle. org B sees nothing; a tech is forbidden.
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

suite("jobs tRPC router (full stack, live RLS)", () => {
  let admin: Sql;
  let orgAId = "";
  let orgBId = "";
  let leadAId = "";

  beforeAll(async () => {
    admin = postgres(process.env.DATABASE_URL as string, { max: 1, ssl: "require", prepare: false });
    const [a] = await admin<{ id: string }[]>`insert into orgs (name) values ('JobApi A ' || gen_random_uuid()) returning id`;
    const [b] = await admin<{ id: string }[]>`insert into orgs (name) values ('JobApi B ' || gen_random_uuid()) returning id`;
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

  // Quote → accept an estimate so createFromEstimate has something to consume.
  const acceptedEstimateId = async (caller: ReturnType<typeof appRouter.createCaller>): Promise<string> => {
    const drafted = await caller.v1.quoting.draft({
      leadId: leadAId,
      title: "Deck",
      lines: [{ description: "Labor", quantity: 5, rateCents: 20_000 }],
    });
    await caller.v1.quoting.send({ estimateId: drafted.id });
    await caller.v1.quoting.accept({ estimateId: drafted.id });
    return drafted.id;
  };

  it("creates a job from an accepted estimate (idempotently) and runs its lifecycle", async () => {
    const caller = appRouter.createCaller(ctxFor(orgAId, "owner"));
    const estimateId = await acceptedEstimateId(caller);

    const job = await caller.v1.jobs.createFromEstimate({ estimateId });
    expect(job.status).toBe("scheduled");
    expect(job.num).toMatch(/^JOB-\d+$/);
    expect(job.total?.cents).toBe(100_000); // 5 * $200.00
    expect(job.sourceEstimateId).toBe(estimateId);

    // Idempotent: a second call returns the same job.
    const again = await caller.v1.jobs.createFromEstimate({ estimateId });
    expect(again.id).toBe(job.id);

    const started = await caller.v1.jobs.start({ jobId: job.id });
    expect(started.status).toBe("in_progress");
    const done = await caller.v1.jobs.complete({ jobId: job.id });
    expect(done.status).toBe("complete");

    const listed = await caller.v1.jobs.list({ limit: 50, status: "complete" });
    expect(listed.items.some((j) => j.id === job.id)).toBe(true);
  });

  it("createFromEstimate is idempotent under CONCURRENT calls (same job, no abort)", async () => {
    // Two separate withTenant transactions race on the same estimate. The loser's INSERT hits the
    // partial unique via ON CONFLICT DO NOTHING (which does NOT abort its tx), so it re-fetches and
    // returns the winner. Before the fix this threw a raw 23505/25P02.
    const caller = appRouter.createCaller(ctxFor(orgAId, "owner"));
    const estimateId = await acceptedEstimateId(caller);
    const [a, b] = await Promise.all([
      caller.v1.jobs.createFromEstimate({ estimateId }),
      caller.v1.jobs.createFromEstimate({ estimateId }),
    ]);
    expect(a.id).toBe(b.id); // both callers got the same job
  });

  it("rejects createFromEstimate when the estimate is not accepted (CONFLICT)", async () => {
    const caller = appRouter.createCaller(ctxFor(orgAId, "owner"));
    const drafted = await caller.v1.quoting.draft({
      leadId: leadAId,
      lines: [{ description: "x", quantity: 1, rateCents: 1_000 }],
    });
    await expect(caller.v1.jobs.createFromEstimate({ estimateId: drafted.id })).rejects.toMatchObject({
      code: "CONFLICT",
    });
  });

  it("rejects cancel with an empty reason (BAD_REQUEST)", async () => {
    const caller = appRouter.createCaller(ctxFor(orgAId, "owner"));
    const job = await caller.v1.jobs.scheduleDirect({ leadId: leadAId, title: "Direct" });
    await expect(caller.v1.jobs.cancel({ jobId: job.id, reason: "" })).rejects.toBeDefined();
  });

  it("a different org sees no jobs", async () => {
    const caller = appRouter.createCaller(ctxFor(orgBId, "owner"));
    const listed = await caller.v1.jobs.list({ limit: 50 });
    expect(listed.items).toHaveLength(0);
  });

  it("a tech is forbidden from the jobs API", async () => {
    const caller = appRouter.createCaller(ctxFor(orgAId, "tech"));
    await expect(caller.v1.jobs.list({ limit: 10 })).rejects.toMatchObject({ code: "FORBIDDEN" });
  });

  // ── Task 5: create / update / archive ─────────────────────────────────────────
  // NOTE: These assertions are WRITTEN but NOT RUN — migration 0047 (jobs.svc) must
  // be applied in the target environment before executing this block.

  it("owner creates a manual job for a lead, edits it, and it lists back", async () => {
    const caller = appRouter.createCaller(ctxFor(orgAId, "owner"));
    const lead = await caller.v1.customers.create({ name: "Manual Job Cust" });

    const created = await caller.v1.jobs.create({
      leadId: lead.id, title: "Water heater", svc: "service", addr: "1 Main", phone: "555", notes: "gate 4",
    });
    expect(created.title).toBe("Water heater");
    expect(created.svc).toBe("service");
    expect(created.status).toBe("scheduled");

    // The Type toggle writes kind now — svc stays what it was declared as, the trade label.
    const updated = await caller.v1.jobs.update({ jobId: created.id, title: "Water heater swap", kind: "estimate" });
    expect(updated.title).toBe("Water heater swap");
    expect(updated.kind).toBe("estimate");
    expect(updated.svc).toBe("service"); // untouched by the type flip

    const listed = await caller.v1.jobs.list({ limit: 500 });
    expect(listed.items.some((j) => j.id === created.id && j.kind === "estimate")).toBe(true);

    // …and back to flat rate.
    const reverted = await caller.v1.jobs.update({ jobId: created.id, kind: "work" });
    expect(reverted.kind).toBe("work");
  });

  it("attaches a checklist via update; it persists, survives a re-read, and detaches with null", async () => {
    const caller = appRouter.createCaller(ctxFor(orgAId, "owner"));
    const lead = await caller.v1.customers.create({ name: "Checklist Job Cust" });
    const created = await caller.v1.jobs.create({ leadId: lead.id, title: "Repipe" });
    expect(created.checklist).toBeNull();

    const checklist = {
      name: "Before you leave",
      items: [
        { id: randomUUID(), text: "Photo of the manifold", type: "photo" as const, required: true },
        { id: randomUUID(), text: "Test water pressure", type: "check" as const, required: false },
      ],
    };
    const updated = await caller.v1.jobs.update({ jobId: created.id, checklist });
    expect(updated.checklist).toEqual(checklist);

    // Survives a fresh read (separate request/tx — proves it hit the jsonb column).
    const reread = await caller.v1.jobs.get({ jobId: created.id });
    expect(reread.checklist).toEqual(checklist);

    // And rides the summary DTO the office hydrator consumes (→ crew's device).
    const listed = await caller.v1.jobs.list({ limit: 500 });
    expect(listed.items.find((j) => j.id === created.id)?.checklist).toEqual(checklist);

    // Explicit null detaches; unrelated updates keep it intact.
    const kept = await caller.v1.jobs.update({ jobId: created.id, title: "Repipe day 2" });
    expect(kept.checklist).toEqual(checklist);
    const detached = await caller.v1.jobs.update({ jobId: created.id, checklist: null });
    expect(detached.checklist).toBeNull();
  });

  it("rejects an invalid checklist (blank name / >50 items) with BAD_REQUEST", async () => {
    const caller = appRouter.createCaller(ctxFor(orgAId, "owner"));
    const lead = await caller.v1.customers.create({ name: "Bad Checklist Cust" });
    const created = await caller.v1.jobs.create({ leadId: lead.id, title: "Temp" });
    await expect(
      caller.v1.jobs.update({ jobId: created.id, checklist: { name: "", items: [] } }),
    ).rejects.toMatchObject({ code: "BAD_REQUEST" });
    const tooMany = Array.from({ length: 51 }, (_, i) => ({
      id: `i${i}`, text: "step", type: "check" as const, required: false,
    }));
    await expect(
      caller.v1.jobs.update({ jobId: created.id, checklist: { name: "Big", items: tooMany } }),
    ).rejects.toMatchObject({ code: "BAD_REQUEST" });
  });

  it("archive soft-deletes a job; it disappears from list", async () => {
    const caller = appRouter.createCaller(ctxFor(orgAId, "owner"));
    const lead = await caller.v1.customers.create({ name: "Archive Job Cust" });
    const created = await caller.v1.jobs.create({ leadId: lead.id, title: "Temp" });
    const res = await caller.v1.jobs.archive({ jobId: created.id });
    expect(res.ok).toBe(true);
    const listed = await caller.v1.jobs.list({ limit: 500 });
    expect(listed.items.some((j) => j.id === created.id)).toBe(false);
  });

  it("update/archive on unknown jobId returns NOT_FOUND", async () => {
    const caller = appRouter.createCaller(ctxFor(orgAId, "owner"));
    await expect(caller.v1.jobs.update({ jobId: randomUUID(), title: "x" })).rejects.toMatchObject({ code: "NOT_FOUND" });
    await expect(caller.v1.jobs.archive({ jobId: randomUUID() })).rejects.toMatchObject({ code: "NOT_FOUND" });
  });

  it("org B cannot update or archive org A's job (NOT_FOUND via RLS)", async () => {
    const callerA = appRouter.createCaller(ctxFor(orgAId, "owner"));
    const lead = await callerA.v1.customers.create({ name: "RLS Job Cust" });
    const created = await callerA.v1.jobs.create({ leadId: lead.id, title: "Boundary" });
    const callerB = appRouter.createCaller(ctxFor(orgBId, "owner"));
    await expect(callerB.v1.jobs.update({ jobId: created.id, title: "nope" })).rejects.toMatchObject({ code: "NOT_FOUND" });
    await expect(callerB.v1.jobs.archive({ jobId: created.id })).rejects.toMatchObject({ code: "NOT_FOUND" });
  });

  it("a tech is forbidden from job.create/update/archive", async () => {
    const callerTech = appRouter.createCaller(ctxFor(orgAId, "tech"));
    await expect(callerTech.v1.jobs.create({ leadId: randomUUID(), title: "x" })).rejects.toMatchObject({ code: "FORBIDDEN" });
    await expect(callerTech.v1.jobs.update({ jobId: randomUUID(), title: "x" })).rejects.toMatchObject({ code: "FORBIDDEN" });
    await expect(callerTech.v1.jobs.archive({ jobId: randomUUID() })).rejects.toMatchObject({ code: "FORBIDDEN" });
  });
});
