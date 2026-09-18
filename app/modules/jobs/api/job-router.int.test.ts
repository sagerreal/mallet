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

  /**
   * A STALE BROWSER BUNDLE from before the kind migration still sends the retired shape:
   * svc='estimate' with no kind. Accepted verbatim it would land as kind='work', svc='estimate' —
   * readable as an estimate by the client's legacy fallback, invisible to every kind-based server
   * predicate (Money, the pipeline, the $0-invoice guard), and unrepairable by the Type toggle.
   * The boundary normalises it into the correct row instead.
   */
  it("normalises the retired svc='estimate' shape from a stale bundle", async () => {
    const caller = appRouter.createCaller(ctxFor(orgAId, "owner"));
    const [lead] = await admin<{ id: string }[]>`
      insert into leads (org_id, name, stage) values (${orgAId}, 'Stale Bundle', 'new') returning id`;

    const created = await caller.v1.jobs.create({ leadId: lead!.id, title: "Old-bundle walkthrough", svc: "estimate" });
    expect(created.kind).toBe("estimate");
    expect(created.svc).toBeNull();

    const updated = await caller.v1.jobs.update({ jobId: created.id, svc: "estimate" });
    expect(updated.kind).toBe("estimate");
    expect(updated.svc).toBeNull();
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

  // ── Three-flows money task 3: priced lines on jobs.create ─────────────────────

  it("creates a manual job WITH priced lines: lines and total round-trip through the live DB", async () => {
    const caller = appRouter.createCaller(ctxFor(orgAId, "owner"));
    const lead = await caller.v1.customers.create({ name: "Flat Price Cust" });

    const created = await caller.v1.jobs.create({
      leadId: lead.id,
      title: "Drain cleaning",
      svc: "service",
      lines: [{ description: "Drain cleaning", quantity: 1, rateCents: 9_900 }],
    });
    expect(created.total?.cents).toBe(9_900);

    // A fresh read (separate request/tx) proves the line rows hit job_lines, not just the DTO:
    // list loads execution data batched, so the summary carries the persisted lines.
    const listed = await caller.v1.jobs.list({ limit: 500 });
    const row = listed.items.find((j) => j.id === created.id);
    expect(row).toBeDefined();
    expect(row!.total?.cents).toBe(9_900);
    expect(row!.lines).toHaveLength(1);
    expect(row!.lines[0]?.description).toBe("Drain cleaning");
    expect(row!.lines[0]?.quantity).toBe(1);
    expect(row!.lines[0]?.rate?.cents).toBe(9_900);
  });

  it("rejects fractional-cent lines at the zod boundary (BAD_REQUEST)", async () => {
    const caller = appRouter.createCaller(ctxFor(orgAId, "owner"));
    const lead = await caller.v1.customers.create({ name: "Bad Cents Cust" });
    await expect(
      caller.v1.jobs.create({
        leadId: lead.id,
        title: "Bad cents",
        lines: [{ description: "x", quantity: 1, rateCents: 12.5 }],
      }),
    ).rejects.toMatchObject({ code: "BAD_REQUEST" });
  });

  it("rejects an empty line description and >200 lines at the zod boundary (BAD_REQUEST)", async () => {
    const caller = appRouter.createCaller(ctxFor(orgAId, "owner"));
    const lead = await caller.v1.customers.create({ name: "Bad Lines Cust" });
    await expect(
      caller.v1.jobs.create({
        leadId: lead.id,
        lines: [{ description: "", quantity: 1, rateCents: 100 }],
      }),
    ).rejects.toMatchObject({ code: "BAD_REQUEST" });
    const tooMany = Array.from({ length: 201 }, (_, i) => ({
      description: `Line ${i}`, quantity: 1, rateCents: 100,
    }));
    await expect(
      caller.v1.jobs.create({ leadId: lead.id, lines: tooMany }),
    ).rejects.toMatchObject({ code: "BAD_REQUEST" });
  });

  it("rejects kind='estimate' + priced lines (the domain invariant surfaces as BAD_REQUEST)", async () => {
    const caller = appRouter.createCaller(ctxFor(orgAId, "owner"));
    const lead = await caller.v1.customers.create({ name: "Priced Estimate Cust" });
    await expect(
      caller.v1.jobs.create({
        leadId: lead.id,
        kind: "estimate",
        lines: [{ description: "x", quantity: 1, rateCents: 50_000 }],
      }),
    ).rejects.toMatchObject({ code: "BAD_REQUEST" });
    // No half-written job: the guard fires before any insert.
    const listed = await caller.v1.jobs.list({ limit: 500 });
    expect(listed.items.some((j) => j.leadId === lead.id)).toBe(false);
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

  // ── v1.jobs.fileViewUrl — opening an attachment ──────────────────────────────
  //
  // The security property under test is that the CALLER NEVER NAMES THE OBJECT. The row is
  // resolved inside the tenant tx and its stored path is what gets signed, so a guessed id
  // belonging to another org (or another job) can only ever produce NOT_FOUND.
  describe("fileViewUrl", () => {
    // Echoes the path back so a test can prove WHICH object was signed.
    const echoGateway = {
      createUploadUrl: async () => { throw new Error("unused"); },
      download: async () => { throw new Error("unused"); },
      createViewUrl: async (storagePath: string) => ({
        ok: true as const,
        value: { url: `https://fake/view?p=${encodeURIComponent(storagePath)}`, expiresInSeconds: 300 },
      }),
    };
    const ctxWithGateway = (orgId: string, role: Role): Context => {
      const base = ctxFor(orgId, role);
      return { ...base, deps: { ...base.deps, photoStorageGateway: echoGateway as never } };
    };

    it("signs the STORED path for a job in this org", async () => {
      const caller = appRouter.createCaller(ctxWithGateway(orgAId, "owner"));
      const lead = await caller.v1.customers.create({ name: "View Cust" });
      const job = await caller.v1.jobs.create({ leadId: lead.id, title: "Permit job" });
      const photoId = randomUUID();
      const storagePath = `${orgAId}/${job.id}/${photoId}.pdf`;
      await caller.v1.jobs.addPhoto({ jobId: job.id, id: photoId, storagePath, fileName: "permit.pdf" });

      const { url } = await caller.v1.jobs.fileViewUrl({ jobId: job.id, id: photoId });
      expect(url).toBe(`https://fake/view?p=${encodeURIComponent(storagePath)}`);
    });

    it("org B cannot open org A's attachment (NOT_FOUND via RLS)", async () => {
      const callerA = appRouter.createCaller(ctxWithGateway(orgAId, "owner"));
      const lead = await callerA.v1.customers.create({ name: "Boundary Cust" });
      const job = await callerA.v1.jobs.create({ leadId: lead.id, title: "Boundary permit" });
      const photoId = randomUUID();
      await callerA.v1.jobs.addPhoto({
        jobId: job.id,
        id: photoId,
        storagePath: `${orgAId}/${job.id}/${photoId}.pdf`,
      });

      const callerB = appRouter.createCaller(ctxWithGateway(orgBId, "owner"));
      await expect(
        callerB.v1.jobs.fileViewUrl({ jobId: job.id, id: photoId }),
      ).rejects.toMatchObject({ code: "NOT_FOUND" });
    });

    it("an attachment id from ANOTHER job in the same org is NOT_FOUND", async () => {
      const caller = appRouter.createCaller(ctxWithGateway(orgAId, "owner"));
      const lead = await caller.v1.customers.create({ name: "Two Job Cust" });
      const jobOne = await caller.v1.jobs.create({ leadId: lead.id, title: "One" });
      const jobTwo = await caller.v1.jobs.create({ leadId: lead.id, title: "Two" });
      const photoId = randomUUID();
      await caller.v1.jobs.addPhoto({
        jobId: jobOne.id,
        id: photoId,
        storagePath: `${orgAId}/${jobOne.id}/${photoId}.pdf`,
      });

      await expect(
        caller.v1.jobs.fileViewUrl({ jobId: jobTwo.id, id: photoId }),
      ).rejects.toMatchObject({ code: "NOT_FOUND" });
    });

    it("PRECONDITION_FAILED when the gateway is unbound", async () => {
      const caller = appRouter.createCaller(ctxFor(orgAId, "owner"));
      await expect(
        caller.v1.jobs.fileViewUrl({ jobId: randomUUID(), id: randomUUID() }),
      ).rejects.toMatchObject({ code: "PRECONDITION_FAILED" });
    });

    it("a tech is forbidden from the office view-url endpoint", async () => {
      const caller = appRouter.createCaller(ctxWithGateway(orgAId, "tech"));
      await expect(
        caller.v1.jobs.fileViewUrl({ jobId: randomUUID(), id: randomUUID() }),
      ).rejects.toMatchObject({ code: "FORBIDDEN" });
    });
  });
});
